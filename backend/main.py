"""
Proxmox Cluster Dashboard - FastAPI Backend (ottimizzato)
"""
import os
import sys
import json
import time
import asyncio
import threading
import urllib.parse
from datetime import datetime, timedelta
from typing import Optional, List, Dict
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, Depends
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from contextlib import asynccontextmanager
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import uvicorn
import bcrypt
import jwt

from config import settings
from database import (
    init_db, get_db, log_activity, log_access,
    get_cost_config, get_cost_config_nodes,
    upsert_cost_config, upsert_node_config,
    get_proxmox_nodes, get_proxmox_node, create_proxmox_node, update_proxmox_node, delete_proxmox_node
)
from proxmox_client import cluster, reload_nodes, init_cluster_from_db
from api.nodes import router as nodes_router
from api.alerts import router as alerts_router

# ─── App Setup ────────────────────────────────────────────────────────────────
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    docs_url="/api/docs",
    redoc_url=None
)

# Routers
app.include_router(nodes_router)
app.include_router(alerts_router)

# Rate limiter setup
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={"detail": "Too many requests. Please try again later."}
    )

app.add_middleware(GZipMiddleware, minimum_size=500)

# CORS: allow specific origins in production, use env var
cors_origins = os.environ.get("CORS_ORIGINS", "").split(",") if os.environ.get("CORS_ORIGINS") else []
if not cors_origins:
    cors_origins = ["http://localhost:3000", "http://localhost:8000", "http://127.0.0.1:3000", "http://127.0.0.1:8000"]
    
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

# ─── Path Resolution ──────────────────────────────────────────────────────────
def _find_frontend_dir() -> Path:
    base = Path(__file__).resolve().parent
    candidates = [
        base.parent / "frontend",
        base / "frontend",
        base.parent.parent / "frontend",
    ]
    for p in candidates:
        if (p / "index.html").exists():
            return p.resolve()
    return (base.parent / "frontend").resolve()

FRONTEND_DIR = _find_frontend_dir()
STATIC_DIR   = Path(__file__).resolve().parent / "static"

# Route per file statici
if STATIC_DIR.exists():
    # /static/assets/...
    @app.get("/static/{path:path}")
    async def serve_static_files(path: str):
        file_path = STATIC_DIR / path
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        raise HTTPException(status_code=404, detail="File not found")

    # /assets/... (percorso usato da Vite build)
    @app.get("/assets/{filename:path}")
    async def serve_assets(filename: str):
        file_path = STATIC_DIR / "assets" / filename
        if file_path.exists() and file_path.is_file():
            return FileResponse(str(file_path))
        raise HTTPException(status_code=404, detail="File not found")

    # Serve favicon
    @app.get("/favicon.svg")
    async def serve_favicon():
        favicon_path = STATIC_DIR / "favicon.svg"
        if favicon_path.exists():
            return FileResponse(str(favicon_path))
        raise HTTPException(status_code=404)

# Cache HTML in memoria: evita lettura da disco ad ogni richiesta /
_frontend_html: Optional[str] = None

def _load_frontend_html() -> Optional[str]:
    global _frontend_html
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        _frontend_html = index_path.read_text(encoding="utf-8")
    return _frontend_html

# ─── WebSocket Manager ────────────────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        if not self.active_connections:
            return
        disconnected = []
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                disconnected.append(connection)
        for conn in disconnected:
            self.disconnect(conn)


manager = ConnectionManager()

# ─── Middleware: Access Logging (fire-and-forget) ─────────────────────────────
@app.middleware("http")
async def access_logging_middleware(request: Request, call_next):
    start_time = time.time()
    response   = await call_next(request)
    duration   = (time.time() - start_time) * 1000
    # log_access è asincrono (coda): non blocca mai la risposta
    ip = request.client.host if request.client else "unknown"
    ua = request.headers.get("user-agent", "")
    log_access(
        username="anonymous",
        action=f"{request.method} {request.url.path}",
        endpoint=request.url.path,
        method=request.method,
        ip_address=ip,
        user_agent=ua[:200],
        status_code=response.status_code,
        response_time_ms=round(duration, 2)
    )
    return response


# ─── In-Memory Response Cache for API ───────────────────────────────────────
_response_cache: Dict[str, Dict] = {}
_cache_lock = threading.Lock()


def _get_cached_response(key: str) -> Optional[Dict]:
    with _cache_lock:
        entry = _response_cache.get(key)
        if entry and (time.time() - entry["ts"]) < 5:  # 5 secondi cache
            return entry["data"]
        return None


def _set_cached_response(key: str, data: Dict):
    with _cache_lock:
        _response_cache[key] = {"ts": time.time(), "data": data, "etag": hash(str(data))}


def _generate_etag(data: Dict) -> str:
    return f'"{hash(str(data)) % 0xFFFFFFFF:x}"'


@app.middleware("http")
async def api_cache_middleware(request: Request, call_next):
    if request.method != "GET" or not request.url.path.startswith("/api/"):
        return await call_next(request)
    
    cache_key = request.url.path
    cached = _get_cached_response(cache_key)
    
    if cached:
        client_etag = request.headers.get("If-None-Match")
        if client_etag and client_etag == cached.get("etag"):
            return JSONResponse(status_code=304, content=None)
    
    response = await call_next(request)
    
    if response.status_code == 200 and hasattr(response, "body"):
        try:
            body = response.body
            if body:
                data = json.loads(body)
                etag = _generate_etag(data)
                _set_cached_response(cache_key, data)
                response.headers["ETag"] = etag
                response.headers["Cache-Control"] = "public, max-age=10"
        except Exception:
            pass
    
    return response

# ─── Auth helpers ─────────────────────────────────────────────────────────────
security = HTTPBearer(auto_error=False)

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except Exception:
        return False

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)

def decode_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except Exception:
        return None

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials:
        raise HTTPException(status_code=401, detail="Token mancante")
    token = credentials.credentials
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Token invalido o scaduto")
    return payload

def verify_user(username: str, password: str) -> Optional[dict]:
    with get_db() as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE username = %s AND is_active = TRUE", (username,)
        ).fetchone()
        if user and verify_password(password, user["password_hash"]):
            return dict(user)
        return None

def get_user_by_username(username: str) -> Optional[dict]:
    with get_db() as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE username = %s",
            (username,),
        ).fetchone()
        return dict(user) if user else None

# ─── Background Task: Proactive Cache Refresh ─────────────────────────────────
# Il refresh viene eseguito proattivamente in background.
# Tutte le richieste API leggono dalla cache in memoria (< 1ms).
# Le richieste non aspettano MAI Proxmox.

REFRESH_INTERVAL = 15  # secondi tra un refresh e l'altro
background_task_running = False

async def metrics_collector():
    """
    Task principale:
      1. Esegue _refresh_node_data() in un thread pool (non blocca l'event loop)
      2. Salva snapshot su DB usando la cache appena aggiornata
      3. Fa broadcast WebSocket con i dati freschi
    Il frontend riceve sempre dati aggiornati senza dover fare polling HTTP.
    """
    global background_task_running
    background_task_running = True
    loop = asyncio.get_event_loop()

    # Prima iterazione: carica subito la cache all'avvio
    try:
        await loop.run_in_executor(None, cluster._refresh_node_data)
    except Exception as e:
        print(f"Initial refresh error: {e}")

    broadcast_counter = 0

    while background_task_running:
        try:
            # Refresh dei dati Proxmox in thread separato (non-blocking)
            await loop.run_in_executor(None, cluster._refresh_node_data)

            # Salva snapshot su DB (usa cache, zero HTTP)
            await loop.run_in_executor(None, cluster.save_metrics_snapshot)

            # Broadcast WebSocket ogni METRICS_POLL_INTERVAL secondi
            broadcast_counter += REFRESH_INTERVAL
            if broadcast_counter >= settings.METRICS_POLL_INTERVAL:
                broadcast_counter = 0
                summary = cluster.get_cluster_summary()
                await manager.broadcast({
                    "type": "metrics_update",
                    "data": summary,
                    "timestamp": datetime.now().isoformat()
                })
                # Logs broadcast meno frequente (ogni 2 cicli di broadcast)
                # per non saturare la connessione WebSocket
                logs = cluster.get_all_logs(limit=20)
                await manager.broadcast({
                    "type": "logs_update",
                    "data": logs,
                    "timestamp": datetime.now().isoformat()
                })

        except Exception as e:
            print(f"Collector error: {e}")

        await asyncio.sleep(REFRESH_INTERVAL)

def ensure_default_users():
    """Create default users if they don't exist."""
    try:
        conn = get_db()
        # Check if admin exists
        conn.execute("SELECT 1 FROM users WHERE username = %s", ("admin",))
        if not conn.fetchone():
            admin_hash = hash_password("admin")
            conn.execute(
                "INSERT INTO users (username, password_hash, email, role, is_active) VALUES (%s, %s, %s, %s, %s)",
                ("admin", admin_hash, "admin@dashboard.local", "admin", True)
            )
            print("  ✅ Default user 'admin' created")
        # Check if viewer exists
        conn.execute("SELECT 1 FROM users WHERE username = %s", ("user",))
        if not conn.fetchone():
            user_hash = hash_password("user")
            conn.execute(
                "INSERT INTO users (username, password_hash, email, role, is_active) VALUES (%s, %s, %s, %s, %s)",
                ("user", user_hash, "user@dashboard.local", "viewer", True)
            )
            print("  ✅ Default user 'user' created")
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"  ⚠️  Error creating default users: {e}")

@app.on_event("startup")
async def startup_event():
    init_db()
    ensure_default_users()
    _load_frontend_html()
    print(f"\n{'='*50}")
    print(f"  {settings.APP_NAME} v{settings.APP_VERSION}")
    print(f"{'='*50}")
    index_ok = (FRONTEND_DIR / "index.html").exists()
    print(f"\n  Frontend dir : {FRONTEND_DIR}")
    print(f"  index.html   : {'OK' if index_ok else 'NON TROVATO!'}")
    if not index_ok:
        print(f"\n  [ATTENZIONE] Frontend non trovato.")
    print(f"\nLoading Proxmox nodes from database...")
    init_cluster_from_db()
    print(f"\nDashboard ready at http://0.0.0.0:{settings.PORT}")
    print(f"Apri nel browser: http://localhost:{settings.PORT}")
    print(f"API docs: http://localhost:{settings.PORT}/api/docs\n")
    log_activity("system", "Dashboard started", severity="info")
    asyncio.create_task(metrics_collector())

@app.on_event("shutdown")
async def shutdown_event():
    global background_task_running
    background_task_running = False
    log_activity("system", "Dashboard stopped", severity="info")

# ─── Routes: Frontend ─────────────────────────────────────────────────────────
@app.get("/")
async def serve_frontend():
    static_path = Path(__file__).resolve().parent / "static" / "index.html"
    if static_path.exists():
        return FileResponse(str(static_path))
    return HTMLResponse(
        f"<h2>Frontend non ancora buildato</h2>"
        f"<p>Esegui <code>cd frontend && npm run build</code> per generare i file.</p>",
        status_code=200
    )

# ─── Routes: Auth ─────────────────────────────────────────────────────────────
@app.post("/api/auth/login")
async def login(request: Request):
    body     = await request.json()
    username = body.get("username", "")
    password = body.get("password", "")
    user     = verify_user(username, password)
    if not user:
        log_activity(username, "Login failed", status="failed",
                     ip_address=request.client.host if request.client else None,
                     severity="warning")
        raise HTTPException(status_code=401, detail="Invalid credentials")
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET last_login = NOW() WHERE username = %s",
            (username,),
        )
        conn.commit()
    
    access_token = create_access_token({"sub": username, "role": user["role"]})
    log_activity(username, "Login successful",
                 ip_address=request.client.host if request.client else None)
    return {"success": True, "username": username, "role": user["role"], "access_token": access_token}

@app.post("/api/auth/logout")
async def logout(request: Request, current_user: dict = Depends(get_current_user)):
    username = current_user.get("sub", "anonymous") if current_user else "anonymous"
    log_activity(username, "Logout",
                 ip_address=request.client.host if request.client else None)
    return {"success": True}

@app.get("/api/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    username = current_user.get("sub")
    user = get_user_by_username(username)
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    return {"username": user["username"], "email": user.get("email"), "role": user["role"]}

@app.post("/api/auth/refresh")
async def refresh_token(current_user: dict = Depends(get_current_user)):
    username = current_user.get("sub")
    user = get_user_by_username(username)
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    access_token = create_access_token({"sub": username, "role": user["role"]})
    return {"access_token": access_token}

# ─── Routes: Cluster ──────────────────────────────────────────────────────────
@app.get("/api/cluster/summary")
async def get_cluster_summary():
    return cluster.get_cluster_summary()

@app.get("/api/cluster/nodes")
async def get_nodes():
    summary = cluster.get_cluster_summary()
    return {"nodes": summary["nodes"]}

@app.get("/api/cluster/health")
async def get_cluster_health():
    """Get cluster health status including HA, quorum, and issues."""
    return cluster.get_cluster_health()

@app.get("/api/cluster/drs")
async def get_drs_recommendations():
    """Get DRS (Distributed Resource Scheduler) recommendations."""
    return cluster.get_drs_recommendations()

@app.get("/api/cluster/placement")
async def get_vm_placement_suggestion():
    """Get suggested best node for VM placement."""
    return cluster.get_vm_placement_suggestion()

@app.get("/api/cluster/vms")
async def get_vms(node: Optional[str] = None):
    vms = cluster.get_all_vms()
    if node:
        vms = [v for v in vms if v.get("node") == node]
    return {"vms": vms, "count": len(vms)}

@app.get("/api/cluster/containers")
async def get_containers(node: Optional[str] = None):
    cts = cluster.get_all_containers()
    if node:
        cts = [c for c in cts if c.get("node") == node]
    return {"containers": cts, "count": len(cts)}

@app.get("/api/cluster/resources")
async def get_resources():
    vms = cluster.get_all_vms()
    cts = cluster.get_all_containers()
    return {"vms": vms, "containers": cts,
            "total_vms": len(vms), "total_containers": len(cts)}

@app.get("/api/cluster/all")
async def get_cluster_all():
    """
    Endpoint aggregato: summary + vms + containers in una sola chiamata.
    La cache è condivisa — zero refresh duplicati.
    """
    summary = cluster.get_cluster_summary()   # aggiorna cache se stale
    vms     = cluster.get_all_vms()           # legge dalla stessa cache
    cts     = cluster.get_all_containers()    # idem
    return {"summary": summary, "vms": vms, "containers": cts}

# ─── Routes: VM / Container Power Actions ─────────────────────────────────────
VALID_VM_ACTIONS  = {"start", "stop", "shutdown", "reboot", "reset", "suspend", "resume"}
VALID_CT_ACTIONS  = {"start", "stop", "shutdown", "reboot", "suspend", "resume"}

@app.post("/api/vms/{node}/{vmid}/{action}")
async def vm_power_action(node: str, vmid: int, action: str, request: Request):
    if action not in VALID_VM_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Azione non valida: {action}. Valori ammessi: {sorted(VALID_VM_ACTIONS)}")
    pnode = cluster.nodes.get(node)
    if not pnode:
        raise HTTPException(status_code=404, detail=f"Nodo '{node}' non trovato")
    if not pnode.connected:
        pnode.authenticate()
    if not pnode.connected:
        raise HTTPException(status_code=503, detail=f"Nodo '{node}' non raggiungibile")
    result = pnode.vm_action(vmid, action)
    if result is None:
        err_msg = pnode.last_error or "Errore sconosciuto"
        if "quorum" in err_msg.lower():
            import proxmox_client as _pc
            ok, msg = _pc.fix_quorum(pnode.host)
            if ok:
                result = pnode.vm_action(vmid, action)
                if result is None:
                    raise HTTPException(status_code=500, detail=pnode.last_error or "Errore dopo fix quorum")
            else:
                raise HTTPException(status_code=500, detail=f"Quorum fix fallito: {msg}")
        else:
            raise HTTPException(status_code=500, detail=err_msg)
    # Invalida cache: il prossimo refresh leggerà lo stato aggiornato
    cluster.invalidate_cache()
    ip = request.client.host if request.client else None
    log_activity("admin", f"VM {vmid} on {node}: {action}", ip_address=ip,
                 severity="warning" if action in ("stop","shutdown","reset") else "info")
    return {"success": True, "task": result, "node": node, "vmid": vmid, "action": action}

@app.post("/api/containers/{node}/{vmid}/{action}")
async def ct_power_action(node: str, vmid: int, action: str, request: Request):
    if action not in VALID_CT_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Azione non valida: {action}. Valori ammessi: {sorted(VALID_CT_ACTIONS)}")
    pnode = cluster.nodes.get(node)
    if not pnode:
        raise HTTPException(status_code=404, detail=f"Nodo '{node}' non trovato")
    if not pnode.connected:
        pnode.authenticate()
    if not pnode.connected:
        raise HTTPException(status_code=503, detail=f"Nodo '{node}' non raggiungibile")
    result = pnode.ct_action(vmid, action)
    if result is None:
        err_msg = pnode.last_error or "Errore sconosciuto"
        if "quorum" in err_msg.lower():
            import proxmox_client as _pc
            ok, msg = _pc.fix_quorum(pnode.host)
            if ok:
                result = pnode.ct_action(vmid, action)
                if result is None:
                    raise HTTPException(status_code=500, detail=pnode.last_error or "Errore dopo fix quorum")
            else:
                raise HTTPException(status_code=500, detail=f"Quorum fix fallito: {msg}")
        else:
            raise HTTPException(status_code=500, detail=err_msg)
    cluster.invalidate_cache()
    ip = request.client.host if request.client else None
    log_activity("admin", f"CT {vmid} on {node}: {action}", ip_address=ip,
                 severity="warning" if action in ("stop","shutdown") else "info")
    return {"success": True, "task": result, "node": node, "vmid": vmid, "action": action}

@app.post("/api/vms/{node}/{vmid}/migrate")
async def migrate_vm(node: str, vmid: int, request: Request):
    """Migra una VM a un altro nodo."""
    body = await request.json()
    target_node = body.get("target_node")
    if not target_node:
        raise HTTPException(status_code=400, detail="target_node è obbligatorio")
    
    if target_node not in cluster.nodes:
        raise HTTPException(status_code=404, detail=f"Nodo target '{target_node}' non trovato")
    
    pnode = cluster.nodes.get(node)
    if not pnode:
        raise HTTPException(status_code=404, detail=f"Nodo sorgente '{node}' non trovato")
    
    if not pnode.connected:
        pnode.authenticate()
    if not pnode.connected:
        raise HTTPException(status_code=503, detail=f"Nodo '{node}' non raggiungibile")
    
    online = pnode.vm_status(vmid)
    is_running = online and online.get("status") == "running"
    target = cluster.nodes.get(target_node)
    
    if not target.connected:
        target.authenticate()
    if not target.connected:
        raise HTTPException(status_code=503, detail=f"Nodo target '{target_node}' non raggiungibile")
    
    migrate_online = body.get("online", True) and is_running
    result = pnode.migrate_vm(vmid, target_node, online=migrate_online)
    
    if result is None:
        raise HTTPException(status_code=500, detail=pnode.last_error or "Errore migrazione")
    
    cluster.invalidate_cache()
    ip = request.client.host if request.client else None
    log_activity("admin", f"VM {vmid} migrata da {node} a {target_node}", 
                 resource=f"qemu:{vmid}", node=node, ip_address=ip, severity="warning")
    return {"success": True, "task": result, "source": node, "target": target_node, "vmid": vmid}

@app.post("/api/containers/{node}/{vmid}/migrate")
async def migrate_container(node: str, vmid: int, request: Request):
    """Migra un container LXC a un altro nodo."""
    body = await request.json()
    target_node = body.get("target_node")
    if not target_node:
        raise HTTPException(status_code=400, detail="target_node è obbligatorio")
    
    if target_node not in cluster.nodes:
        raise HTTPException(status_code=404, detail=f"Nodo target '{target_node}' non trovato")
    
    pnode = cluster.nodes.get(node)
    if not pnode:
        raise HTTPException(status_code=404, detail=f"Nodo sorgente '{node}' non trovato")
    
    if not pnode.connected:
        pnode.authenticate()
    if not pnode.connected:
        raise HTTPException(status_code=503, detail=f"Nodo '{node}' non raggiungibile")
    
    target = cluster.nodes.get(target_node)
    if not target.connected:
        target.authenticate()
    if not target.connected:
        raise HTTPException(status_code=503, detail=f"Nodo target '{target_node}' non raggiungibile")
    
    result = pnode.migrate_ct(vmid, target_node, online=body.get("online", True))
    
    if result is None:
        raise HTTPException(status_code=500, detail=pnode.last_error or "Errore migrazione")
    
    cluster.invalidate_cache()
    ip = request.client.host if request.client else None
    log_activity("admin", f"CT {vmid} migrato da {node} a {target_node}", 
                 resource=f"lxc:{vmid}", node=node, ip_address=ip, severity="warning")
    return {"success": True, "task": result, "source": node, "target": target_node, "vmid": vmid}

# ─── Routes: Metrics History ──────────────────────────────────────────────────
@app.get("/api/metrics/history")
async def get_metrics_history(node: Optional[str] = None, hours: int = 24):
    with get_db() as conn:
        since = (datetime.now() - timedelta(hours=hours)).isoformat()
        if node:
            rows = conn.execute("""
                SELECT * FROM metrics_snapshots
                WHERE node_name = %s AND timestamp >= %s
                ORDER BY timestamp DESC LIMIT 500
            """, (node, since)).fetchall()
        else:
            rows = conn.execute("""
                SELECT * FROM metrics_snapshots
                WHERE timestamp >= %s
                ORDER BY timestamp DESC LIMIT 1000
            """, (since,)).fetchall()
        return {"data": [dict(r) for r in rows]}

# ─── Routes: Services ─────────────────────────────────────────────────────────
@app.get("/api/services")
async def get_services():
    try:
        services = cluster.get_all_services()
        result = {}
        for node_name, svc_list in services.items():
            if svc_list:
                result[node_name] = svc_list
        return {"services": result, "count": sum(len(s) for s in result.values())}
    except Exception as e:
        print(f"Error getting services: {e}")
        return {"services": {}, "count": 0, "error": str(e)}

# ─── Routes: Logs ─────────────────────────────────────────────────────────────
@app.get("/api/logs/realtime")
async def get_realtime_logs(limit: int = 100, node: Optional[str] = None):
    logs = cluster.get_all_logs(limit=limit)
    if node:
        logs = [l for l in logs if l.get("node") == node]
    return {"logs": logs, "count": len(logs)}

@app.get("/api/logs/activity")
async def get_activity_logs(limit: int = 100, severity: Optional[str] = None):
    with get_db() as conn:
        if severity:
            rows = conn.execute("""
                SELECT * FROM activity_log WHERE severity = %s
                ORDER BY timestamp DESC LIMIT %s
            """, (severity, limit)).fetchall()
        else:
            rows = conn.execute("""
                SELECT * FROM activity_log ORDER BY timestamp DESC LIMIT %s
            """, (limit,)).fetchall()
        return {"logs": [dict(r) for r in rows], "count": len(rows)}

@app.get("/api/logs/access")
async def get_access_logs(limit: int = 100):
    with get_db() as conn:
        rows = conn.execute("""
            SELECT * FROM access_log ORDER BY timestamp DESC LIMIT %s
        """, (limit,)).fetchall()
        return {"logs": [dict(r) for r in rows], "count": len(rows)}

# ─── Routes: Tasks ────────────────────────────────────────────────────────────
@app.get("/api/tasks")
async def get_tasks(limit: int = 50):
    tasks = cluster.get_all_tasks(limit=limit)
    return {"tasks": tasks, "count": len(tasks)}

# ─── Routes: Storage ──────────────────────────────────────────────────────────
@app.get("/api/storage")
async def get_storage():
    storage = cluster.get_storage_all()
    all_storage = []
    for node_name, items in storage.items():
        for item in (items or []):
            item["node"] = node_name
            all_storage.append(item)
    return {"storage": all_storage}

@app.post("/api/storage/refresh")
async def refresh_storage():
    cluster.invalidate_cache()
    # Forza un nuovo caricamento dello storage alla richiesta successiva
    cluster.get_storage_all()
    return {"success": True}

# ─── Routes: Snapshots ──────────────────────────────────────────────────────────
@app.get("/api/snapshots/{node}/{vmid}")
async def get_vm_snapshots(node: str, vmid: int, vtype: str = "qemu"):
    pnode = cluster.nodes.get(node)
    if not pnode:
        raise HTTPException(status_code=404, detail=f"Nodo '{node}' non trovato")
    if not pnode.connected:
        pnode.authenticate()
    if not pnode.connected:
        raise HTTPException(status_code=503, detail=f"Nodo '{node}' non raggiungibile")
    snapshots = cluster.get_vm_snapshots(node, vmid, vtype)
    return {"snapshots": snapshots, "count": len(snapshots)}

@app.post("/api/snapshots/{node}/{vmid}")
async def create_snapshot(node: str, vmid: int, request: Request, vtype: str = "qemu"):
    pnode = cluster.nodes.get(node)
    if not pnode:
        raise HTTPException(status_code=404, detail=f"Nodo '{node}' non trovato")
    if not pnode.connected:
        pnode.authenticate()
    if not pnode.connected:
        raise HTTPException(status_code=503, detail=f"Nodo '{node}' non raggiungibile")
    body = await request.json()
    snapname = body.get("snapname")
    description = body.get("description", "")
    if not snapname:
        raise HTTPException(status_code=400, detail="snapname è obbligatorio")
    result = cluster.create_vm_snapshot(node, vmid, snapname, vtype, description)
    if result is None:
        raise HTTPException(status_code=500, detail=pnode.last_error or "Errore creazione snapshot")
    log_activity("admin", f"Snapshot created: {snapname} on {vtype}/{vmid}", 
                 resource=f"{vtype}:{vmid}", node=node, severity="info")
    return {"success": True, "result": result}

@app.delete("/api/snapshots/{node}/{vmid}/{snapname}")
async def delete_snapshot(node: str, vmid: int, snapname: str, request: Request, vtype: str = "qemu"):
    pnode = cluster.nodes.get(node)
    if not pnode:
        raise HTTPException(status_code=404, detail=f"Nodo '{node}' non trovato")
    if not pnode.connected:
        pnode.authenticate()
    if not pnode.connected:
        raise HTTPException(status_code=503, detail=f"Nodo '{node}' non raggiungibile")
    result = cluster.delete_vm_snapshot(node, vmid, snapname, vtype)
    if result is None:
        raise HTTPException(status_code=500, detail=pnode.last_error or "Errore eliminazione snapshot")
    log_activity("admin", f"Snapshot deleted: {snapname} on {vtype}/{vmid}",
                 resource=f"{vtype}:{vmid}", node=node, severity="warning")
    return {"success": True, "result": result}

@app.post("/api/snapshots/{node}/{vmid}/{snapname}/restore")
async def restore_snapshot(node: str, vmid: int, snapname: str, request: Request, vtype: str = "qemu"):
    """Ripristina una VM/container da uno snapshot."""
    body = await request.json()
    start_after = body.get("start", False)
    
    pnode = cluster.nodes.get(node)
    if not pnode:
        raise HTTPException(status_code=404, detail=f"Nodo '{node}' non trovato")
    if not pnode.connected:
        pnode.authenticate()
    if not pnode.connected:
        raise HTTPException(status_code=503, detail=f"Nodo '{node}' non raggiungibile")
    
    result = cluster.restore_vm_snapshot(node, vmid, snapname, vtype, start=start_after)
    if result is None:
        raise HTTPException(status_code=500, detail=pnode.last_error or "Errore ripristino snapshot")
    
    cluster.invalidate_cache()
    log_activity("admin", f"Snapshot ripristinato: {snapname} on {vtype}/{vmid}",
                 resource=f"{vtype}:{vmid}", node=node, severity="warning")
    return {"success": True, "result": result}

@app.get("/api/snapshots/all")
async def get_all_snapshots():
    all_snapshots = cluster.get_all_snapshots()
    result = []
    for node_name, snaps in all_snapshots.items():
        for snap in snaps:
            snap["node"] = node_name
            result.append(snap)
    return {"snapshots": result, "count": len(result)}

# ─── Routes: Backup ────────────────────────────────────────────────────────────

@app.get("/api/backup/history/{node}/{vmid}")
async def get_backup_history(node: str, vmid: int, storage: Optional[str] = None):
    pnode = cluster.nodes.get(node)
    if not pnode:
        raise HTTPException(status_code=404, detail=f"Nodo '{node}' non trovato")
    if not pnode.connected:
        pnode.authenticate()
    if not pnode.connected:
        return {"backups": [], "count": 0, "warning": f"Nodo '{node}' non raggiungibile"}

    all_storage = cluster.get_storage_all()
    node_storages = all_storage.get(node, [])
    backup_storages = [
        s["storage"] for s in node_storages
        if s.get("type") in ("pbs", "dir", "nfs", "cifs")
        and s.get("enabled", True)
    ] if not storage else [storage]

    entries = []
    warning = None

    if not backup_storages:
        warning = "Nessuno storage di tipo backup disponibile per questo nodo"

    for stor in backup_storages:
        try:
            items = pnode.get_pbs_backups(vmid, stor)
            for item in (items or []):
                item["storage"] = stor
                item["node"] = node
                item["type"] = "backup"
                item["volid"] = item.get("volid") or item.get("name")
                item["ctime"] = item.get("ctime") or item.get("time") or item.get("backup_time")
                entries.append(item)
        except Exception as e:
            warning = warning or f"Storage '{stor}' non raggiungibile: {str(e)}"

    entries.sort(key=lambda x: x.get("ctime", 0), reverse=True)
    result = {"backups": entries, "count": len(entries)}
    if warning:
        result["warning"] = warning
    return result

@app.get("/api/backup/jobs")
async def get_backup_jobs():
    jobs = cluster.get_backup_jobs()
    return {"jobs": jobs, "count": len(jobs)}

@app.post("/api/backup/trigger/{node}/{vmid}")
async def trigger_backup(node: str, vmid: int, request: Request, vtype: str = "qemu"):
    pnode = cluster.nodes.get(node)
    if not pnode:
        raise HTTPException(status_code=404, detail=f"Nodo '{node}' non trovato")
    if not pnode.connected:
        pnode.authenticate()
    if not pnode.connected:
        raise HTTPException(status_code=503, detail=f"Nodo '{node}' non raggiungibile")
    body = await request.json()
    storage = body.get("storage")
    mode = body.get("mode", "snapshot")
    if not storage:
        raise HTTPException(status_code=400, detail="storage è obbligatorio")
    result = cluster.trigger_backup(node, vmid, storage, mode, vtype)
    if result is None:
        raise HTTPException(status_code=500, detail=pnode.last_error or "Errore trigger backup")
    log_activity("admin", f"Backup triggered: {vtype}/{vmid} on {node}",
                 resource=f"{vtype}:{vmid}", node=node, severity="info")
    return {"success": True, "result": result, "node": node, "vmid": vmid}

@app.get("/api/backup/storages")
async def get_backup_storages():
    storage = cluster.get_storage_all()
    backup_storages = []
    for node_name, items in storage.items():
        for item in items:
            if item.get("type") in ("pbs", "dir") and item.get("enabled"):
                item["node"] = node_name
                backup_storages.append(item)
    return {"storages": backup_storages}

@app.get("/api/backup/restore-storages/{node}")
async def get_restore_storages(node: str, vtype: str = "qemu"):
    """
    Restituisce solo gli storage del nodo specificato compatibili
    con il restore: devono supportare 'images' (qemu) o 'rootdir' (lxc).
    """
    storage = cluster.get_storage_all()
    node_items = storage.get(node, [])
    required_content = "rootdir" if vtype == "lxc" else "images"
    compatible = []
    for item in node_items:
        content = item.get("content", "")
        if required_content in content:
            compatible.append({
                "storage": item.get("storage") or item.get("id"),
                "type": item.get("type"),
                "content": content,
                "node": node,
            })
    return {"storages": compatible}

@app.delete("/api/backup/{node}/{storage}/{volid:path}")
async def delete_backup(node: str, storage: str, volid: str, request: Request):
    pnode = cluster.nodes.get(node)
    if not pnode:
        raise HTTPException(status_code=404, detail=f"Nodo '{node}' non trovato")
    if not pnode.connected:
        pnode.authenticate()
    if not pnode.connected:
        raise HTTPException(status_code=503, detail=f"Nodo '{node}' non raggiungibile")
    try:
        result = pnode._delete(f"/nodes/{node}/storage/{storage}/content/{volid}")
        if result is None:
            raise HTTPException(status_code=500, detail=pnode.last_error or "Errore eliminazione backup")
        log_activity("admin", f"Backup eliminato: {volid} su {storage}",
                     node=node, severity="warning")
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/backup/{node}/{storage}/restore")
async def restore_backup(node: str, storage: str, request: Request):
    body = await request.json()
    volid = body.get("volid")
    vmid = body.get("vmid")
    target_storage = body.get("target_storage", "local")
    if not volid or not vmid:
        raise HTTPException(status_code=400, detail="volid e vmid sono obbligatori")
    pnode = cluster.nodes.get(node)
    if not pnode:
        raise HTTPException(status_code=404, detail=f"Nodo '{node}' non trovato")
    if not pnode.connected:
        pnode.authenticate()
    if not pnode.connected:
        raise HTTPException(status_code=503, detail=f"Nodo '{node}' non raggiungibile")
    try:
        # Proxmox API: restore = POST /nodes/{node}/qemu (o /lxc), stesso endpoint
        # della creazione VM con il param 'archive' che punta al volid del backup.
        vtype = "lxc" if "lxc" in volid.lower() else "qemu"
        result = pnode._post(f"/nodes/{node}/{vtype}", {
            "vmid": vmid,
            "archive": volid,
            "storage": target_storage,
            "force": 1,
        })
        if result is None:
            raise HTTPException(status_code=500, detail=pnode.last_error or "Errore ripristino")
        cluster.invalidate_cache()
        log_activity("admin", f"Backup ripristinato: {volid} → vmid {vmid}",
                     node=node, severity="warning")
        return {"success": True, "task": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ─── Routes: Budget ───────────────────────────────────────────────────────────
@app.get("/api/budget")
async def get_budget():
    return cluster.calculate_costs()

@app.get("/api/budget/config")
async def get_budget_config():
    with get_db() as conn:
        rows = conn.execute("SELECT key, value FROM cost_config WHERE category = 'budget'").fetchall()
        config = {}
        for row in rows:
            try:
                config[row['key']] = float(row['value'])
            except:
                config[row['key']] = row['value']
        
        node_rows = conn.execute(
            "SELECT node_name as name, tdp_idle_w as idle, tdp_max_w as max_w, enabled FROM cost_config_nodes"
        ).fetchall()
        nodes = [dict(r) for r in node_rows]
        
        if not nodes:
            nodes = [
                {"name": "G5ProxMox1", "watt": 50, "enabled": True},
                {"name": "G5ProxMox2", "watt": 50, "enabled": True},
                {"name": "G5ProxMox3", "watt": 50, "enabled": True},
            ]
        
        return {**config, "nodes": nodes}

@app.post("/api/budget/config")
async def save_budget_config(request: Request):
    body = await request.json()
    with get_db() as conn:
        budget_keys = [
            'electricity_cost_kwh', 'node_tdp_idle_w', 'node_tdp_max_w',
            'node_hours_per_month', 'cooling_overhead_pct', 'monthly_connectivity',
            'proxmox_subscription_per_node', 'monthly_backup_offsite',
            'hardware_cost_per_node', 'hardware_amortization_months', 'monthly_budget'
        ]
        
        for key in budget_keys:
            if key in body:
                value = str(body[key])
                conn.execute("""
                    INSERT INTO cost_config (category, key, value)
                    VALUES ('budget', %s, %s)
                    ON CONFLICT (key) DO UPDATE SET
                        category = EXCLUDED.category,
                        value = EXCLUDED.value
                """, (key, value))
        
        if 'nodes' in body:
            for node in body['nodes']:
                enabled = bool(node.get('enabled', True))
                conn.execute("""
                    INSERT INTO cost_config_nodes (node_name, tdp_idle_w, tdp_max_w, enabled)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (node_name) DO UPDATE SET
                        tdp_idle_w = EXCLUDED.tdp_idle_w,
                        tdp_max_w = EXCLUDED.tdp_max_w,
                        enabled = EXCLUDED.enabled,
                        updated_at = CURRENT_TIMESTAMP
                """, (
                    node['name'],
                    float(body.get('node_tdp_idle_w', 20)),
                    float(body.get('node_tdp_max_w', 65)),
                    enabled
                ))
        
        conn.commit()
        log_activity("admin", "Budget configuration updated", severity="info")
        return {"success": True}

@app.get("/api/budget/history")
async def get_budget_history():
    with get_db() as conn:
        rows = conn.execute("""
            SELECT * FROM budget_records ORDER BY timestamp DESC LIMIT 200
        """).fetchall()
        return {"records": [dict(r) for r in rows]}

# ─── Routes: Cost Config ──────────────────────────────────────────────────────
@app.get("/api/cost-config")
async def get_cost_config_api():
    with get_db() as conn:
        global_rows = conn.execute("SELECT * FROM cost_config ORDER BY category, key").fetchall()
        node_rows   = conn.execute("SELECT * FROM cost_config_nodes").fetchall()
        return {
            "global": [dict(r) for r in global_rows],
            "nodes":  [dict(r) for r in node_rows],
        }

@app.post("/api/cost-config/global")
async def update_global_cost_config(request: Request):
    body = await request.json()
    allowed_keys = {
        "electricity_cost_kwh", "cooling_overhead_pct",
        "monthly_connectivity", "proxmox_subscription_per_node",
        "monthly_backup_offsite", "monthly_budget"
    }
    updated = []
    for key, value in body.items():
        if key not in allowed_keys:
            raise HTTPException(status_code=400, detail=f"Chiave non consentita: {key}")
        try:
            upsert_cost_config(key, float(value))
            updated.append(key)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    log_activity("admin", f"Cost config updated: {', '.join(updated)}", severity="info")
    return {"success": True, "updated": updated}

@app.post("/api/cost-config/node/{node_name}")
async def update_node_cost_config(node_name: str, request: Request):
    body    = await request.json()
    allowed = {"tdp_idle_w", "tdp_max_w", "hours_per_month", "hardware_cost", "amortization_months"}
    params  = {}
    for key, value in body.items():
        if key not in allowed:
            raise HTTPException(status_code=400, detail=f"Parametro non consentito: {key}")
        params[key] = float(value)
    try:
        upsert_node_config(node_name, params)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    log_activity("admin", f"Node cost config updated: {node_name}", severity="info")
    return {"success": True, "node": node_name, "params": params}

# ─── Routes: Governance / Users ───────────────────────────────────────────────
@app.get("/api/governance/users")
async def get_users():
    with get_db() as conn:
        rows = conn.execute("""
            SELECT id, username, email, role, is_active, created_at, last_login
            FROM users ORDER BY created_at DESC
        """).fetchall()
        return {"users": [dict(r) for r in rows]}

@app.post("/api/governance/users")
async def create_user(request: Request):
    body     = await request.json()
    username = body.get("username")
    password = body.get("password")
    email    = body.get("email", "")
    role     = body.get("role", "viewer")
    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password required")
    with get_db() as conn:
        try:
            conn.execute("""
                INSERT INTO users (username, password_hash, email, role)
                VALUES (%s, %s, %s, %s)
            """, (username, hash_password(password), email, role))
            conn.commit()
            log_activity("admin", f"User created: {username}", severity="info")
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))
        return {"success": True, "username": username}

@app.get("/api/governance/audit")
async def get_audit_log(limit: int = 200):
    with get_db() as conn:
        rows = conn.execute("""
            SELECT * FROM activity_log ORDER BY timestamp DESC LIMIT %s
        """, (limit,)).fetchall()
        return {"audit": [dict(r) for r in rows], "count": len(rows)}

# ─── Routes: Account Management ─────────────────────────────────────────────
@app.get("/api/account/profile")
async def get_account_profile(current_user: dict = Depends(get_current_user)):
    username = current_user.get("sub")
    with get_db() as conn:
        user = conn.execute("""
            SELECT id, username, email, role, is_active, created_at, last_login
            FROM users WHERE username = %s
        """, (username,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="Utente non trovato")
        return dict(user)

@app.put("/api/account/profile")
async def update_account_profile(request: Request, current_user: dict = Depends(get_current_user)):
    body = await request.json()
    username = current_user.get("sub")
    email = body.get("email", "")
    with get_db() as conn:
        conn.execute("UPDATE users SET email = %s WHERE username = %s", (email, username))
        conn.commit()
        log_activity(username, "Profilo aggiornato", severity="info")
        return {"success": True}

@app.post("/api/account/password")
async def change_account_password(request: Request, current_user: dict = Depends(get_current_user)):
    body = await request.json()
    current_password = body.get("current_password")
    new_password = body.get("new_password")
    confirm_password = body.get("confirm_password")
    
    if not current_password or not new_password or not confirm_password:
        raise HTTPException(status_code=400, detail="Tutti i campi sono obbligatori")
    
    if new_password != confirm_password:
        raise HTTPException(status_code=400, detail="Le password non corrispondono")
    
    username = current_user["sub"]
    
    with get_db() as conn:
        user = conn.execute("SELECT * FROM users WHERE username = %s", (username,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="Utente non trovato")
        
        if not verify_password(current_password, user["password_hash"]):
            log_activity(username, "Tentativo cambio password fallito", severity="warning")
            raise HTTPException(status_code=401, detail="Password attuale non corretta")
        
        new_hash = hash_password(new_password)
        conn.execute("UPDATE users SET password_hash = %s WHERE username = %s", (new_hash, username))
        conn.commit()
        log_activity(username, "Password cambiata", severity="info")
        return {"success": True}

# ─── Routes: Admin User Management ──────────────────────────────────────────
@app.get("/api/admin/users")
async def admin_get_users():
    with get_db() as conn:
        rows = conn.execute("""
            SELECT id, username, email, role, is_active, created_at, last_login
            FROM users ORDER BY created_at DESC
        """).fetchall()
        users = [dict(r) for r in rows]
        
        for user in users:
            activity_count = conn.execute("""
                SELECT COUNT(*) AS activity_count FROM activity_log WHERE "user" = %s
            """, (user["username"],)).fetchone()["activity_count"]
            user["activity_count"] = activity_count
            
            access_count = conn.execute("""
                SELECT COUNT(*) AS access_count FROM access_log WHERE username = %s
            """, (user["username"],)).fetchone()["access_count"]
            user["access_count"] = access_count
            
            last_activity = conn.execute("""
                SELECT timestamp, action FROM activity_log WHERE "user" = %s ORDER BY timestamp DESC LIMIT 1
            """, (user["username"],)).fetchone()
            user["last_activity"] = dict(last_activity) if last_activity else None
        
        return {"users": users, "count": len(users)}

@app.get("/api/admin/users/{username}/activity")
async def admin_get_user_activity(username: str, limit: int = 50):
    with get_db() as conn:
        rows = conn.execute("""
            SELECT * FROM activity_log WHERE "user" = %s
            ORDER BY timestamp DESC LIMIT %s
        """, (username, limit)).fetchall()
        return {"activity": [dict(r) for r in rows], "count": len(rows)}

@app.get("/api/admin/users/{username}/access")
async def admin_get_user_access(username: str, limit: int = 50):
    with get_db() as conn:
        rows = conn.execute("""
            SELECT * FROM access_log WHERE username = %s
            ORDER BY timestamp DESC LIMIT %s
        """, (username, limit)).fetchall()
        return {"access": [dict(r) for r in rows], "count": len(rows)}

@app.post("/api/admin/users")
async def admin_create_user(request: Request):
    body = await request.json()
    username = body.get("username")
    password = body.get("password")
    email = body.get("email", "")
    role = body.get("role", "viewer")
    
    if not username or not password:
        raise HTTPException(status_code=400, detail="Username e password sono obbligatori")
    
    if len(password) < 6:
        raise HTTPException(status_code=400, detail="Password deve essere di almeno 6 caratteri")
    
    with get_db() as conn:
        try:
            conn.execute("""
                INSERT INTO users (username, password_hash, email, role)
                VALUES (%s, %s, %s, %s)
            """, (username, hash_password(password), email, role))
            conn.commit()
            log_activity("admin", f"Utente creato: {username}", severity="info")
            return {"success": True, "username": username}
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

@app.put("/api/admin/users/{username}")
async def admin_update_user(username: str, request: Request):
    body = await request.json()
    with get_db() as conn:
        user = conn.execute("SELECT * FROM users WHERE username = %s", (username,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="Utente non trovato")
        
        allowed_fields = ["email", "role", "is_active"]
        updates = {k: v for k, v in body.items() if k in allowed_fields}
        
        if not updates:
            return {"success": True, "message": "Nessun aggiornamento"}
        
        for key, value in updates.items():
            if key == "is_active":
                value = bool(value)
            conn.execute(f"UPDATE users SET {key} = %s WHERE username = %s", (value, username))
        
        conn.commit()
        log_activity("admin", f"Utente aggiornato: {username}", severity="info")
        return {"success": True, "updates": list(updates.keys())}

@app.post("/api/admin/users/{username}/reset-password")
async def admin_reset_password(username: str, request: Request):
    body = await request.json()
    new_password = body.get("new_password")
    
    if not new_password or len(new_password) < 6:
        new_password = f"Temp_{username}_{datetime.now().strftime('%Y%m%d%H%M')}"
    
    with get_db() as conn:
        user = conn.execute("SELECT * FROM users WHERE username = %s", (username,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="Utente non trovato")
        
        conn.execute("UPDATE users SET password_hash = %s WHERE username = %s",
                      (hash_password(new_password), username))
        conn.commit()
        
        log_activity("admin", f"Password resettata per: {username}", resource=f"user:{username}", severity="warning")
        return {"success": True, "new_password": new_password}

@app.post("/api/admin/users/{username}/toggle-active")
async def admin_toggle_user_active(username: str, request: Request):
    with get_db() as conn:
        user = conn.execute("SELECT * FROM users WHERE username = %s", (username,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="Utente non trovato")
        
        if username == "admin":
            raise HTTPException(status_code=400, detail="Non puoi disabilitare l'admin")
        
        new_status = not bool(user["is_active"])
        conn.execute("UPDATE users SET is_active = %s WHERE username = %s", (new_status, username))
        conn.commit()
        
        status_text = "abilitato" if new_status else "disabilitato"
        log_activity("admin", f"Utente {status_text}: {username}", severity="warning")
        return {"success": True, "is_active": new_status}

@app.post("/api/admin/users/{username}/force-logout")
async def admin_force_logout(username: str, request: Request):
    log_activity("admin", f"Sessione terminata per: {username}", resource=f"user:{username}", severity="warning")
    return {"success": True, "message": f"Sessione terminata per {username}"}

@app.delete("/api/admin/users/{username}")
async def admin_delete_user(username: str, request: Request):
    if username == "admin":
        raise HTTPException(status_code=400, detail="Non puoi eliminare l'admin")
    
    with get_db() as conn:
        user = conn.execute("SELECT * FROM users WHERE username = %s", (username,)).fetchone()
        if not user:
            raise HTTPException(status_code=404, detail="Utente non trovato")
        
        conn.execute("DELETE FROM users WHERE username = %s", (username,))
        conn.commit()
        
        log_activity("admin", f"Utente eliminato: {username}", severity="critical")
        return {"success": True}

# ─── WebSocket ────────────────────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        try:
            summary = cluster.get_cluster_summary()
        except Exception:
            summary = {
                "nodes": [], "total_vms": 0, "total_containers": 0,
                "total_cpu_cores": 0, "total_mem_gb": 0, "total_disk_tb": 0,
                "used_cpu_percent": 0, "used_mem_percent": 0, "used_disk_percent": 0,
                "online_nodes": 0, "offline_nodes": 0, "timestamp": datetime.now().isoformat()
            }
        await websocket.send_json({
            "type": "connected",
            "data": summary,
            "timestamp": datetime.now().isoformat()
        })
        while True:
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=1.0)
                if msg == "ping":
                    await websocket.send_json({"type": "pong"})
            except asyncio.TimeoutError:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)

# ─── Health check ─────────────────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "timestamp": datetime.now().isoformat(),
        "nodes_configured": len(cluster.nodes),
        "nodes_connected": sum(1 for n in cluster.nodes.values() if n.connected)
    }

# ─── Entry Point ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        access_log=False,
        # Più worker non sono utili su Windows con threading (GIL),
        # ma loop policy ottimizzata aiuta su asyncio
    )