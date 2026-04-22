import json

from fastapi import APIRouter, HTTPException, Request
from starlette.requests import ClientDisconnect

import requests

from config import settings

from database import (
    log_activity,
    get_proxmox_nodes,
    get_proxmox_node,
    create_proxmox_node,
    update_proxmox_node,
    delete_proxmox_node,
)
from proxmox_client import reload_nodes


router = APIRouter(tags=["nodes"])

def _fetch_cluster_node_names(host: str, port: int, timeout: int) -> list[str]:
    """
    Validate that the Proxmox API is reachable and credentials work.
    Returns the list of node names returned by /api2/json/nodes.
    """
    base_url = f"https://{host}:{port}/api2/json"
    verify = bool(settings.PROXMOX_VERIFY_SSL)

    if settings.PROXMOX_TOKEN_NAME and settings.PROXMOX_TOKEN_VALUE:
        headers = {
            "Authorization": (
                f"PVEAPIToken={settings.PROXMOX_USER}!"
                f"{settings.PROXMOX_TOKEN_NAME}={settings.PROXMOX_TOKEN_VALUE}"
            )
        }
        r = requests.get(f"{base_url}/nodes", headers=headers, timeout=timeout, verify=verify)
        if r.status_code != 200:
            raise HTTPException(status_code=502, detail=f"Proxmox nodes list failed: HTTP {r.status_code}")
        data = r.json().get("data") or []
        return [n.get("node") for n in data if n.get("node")]

    # Password-based auth
    r = requests.post(
        f"{base_url}/access/ticket",
        data={"username": settings.PROXMOX_USER, "password": settings.PROXMOX_PASSWORD},
        timeout=timeout,
        verify=verify,
    )
    if r.status_code == 401:
        raise HTTPException(status_code=401, detail="Credenziali Proxmox non valide (401)")
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Proxmox auth failed: HTTP {r.status_code}")

    ticket = r.json().get("data", {}).get("ticket")
    if not ticket:
        raise HTTPException(status_code=502, detail="Proxmox auth failed: missing ticket")

    headers = {"Cookie": f"PVEAuthCookie={ticket}"}
    r = requests.get(f"{base_url}/nodes", headers=headers, timeout=timeout, verify=verify)
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Proxmox nodes list failed: HTTP {r.status_code}")
    data = r.json().get("data") or []
    return [n.get("node") for n in data if n.get("node")]


@router.get("/api/nodes")
async def get_all_nodes():
    """Get all configured Proxmox nodes."""
    nodes = get_proxmox_nodes()
    return {"nodes": nodes, "count": len(nodes)}


@router.get("/api/nodes/{node_name}")
async def get_node(node_name: str):
    """Get a specific Proxmox node."""
    node = get_proxmox_node(node_name)
    if not node:
        raise HTTPException(status_code=404, detail=f"Nodo '{node_name}' non trovato")
    return node


@router.post("/api/nodes")
async def create_node(request: Request):
    """Create a new Proxmox node."""
    try:
        raw = await request.body()
    except ClientDisconnect:
        # Nginx/browser closed the connection while uploading the request body.
        raise HTTPException(status_code=499, detail="Client disconnected while sending request body")

    try:
        body = json.loads(raw.decode("utf-8") if raw else "{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    name = body.get("name")
    host = body.get("host")
    if not name or not host:
        raise HTTPException(status_code=400, detail="name e host sono obbligatori")

    port = body.get("port", 8006)
    timeout = body.get("timeout", 8)
    zone = body.get("zone", "Default")

    # Validate node name against Proxmox API (prevents "offline" due to name mismatch).
    names = _fetch_cluster_node_names(host, int(port), int(timeout))
    requested_name = name
    if name not in names:
        # Allow users to paste FQDN (e.g. "dash.pontos") while Proxmox node name is often just "dash".
        base = str(name).split(".")[0]
        if base in names:
            name = base
        else:
            raise HTTPException(
                status_code=400,
                detail={
                    "message": "Nome nodo non valido per Proxmox API",
                    "provided": requested_name,
                    "expected": names,
                },
            )

    node = create_proxmox_node(name, host, port, timeout, zone)
    reload_nodes()
    log_activity("admin", f"Nodo creato: {name}", resource=f"node:{name}", severity="info")
    return {"success": True, "node": node, "requested_name": requested_name, "api_node_name": name}


@router.put("/api/nodes/{node_name}")
async def update_node(node_name: str, request: Request):
    """Update a Proxmox node."""
    body = await request.json()
    node = update_proxmox_node(node_name, **body)
    if not node:
        raise HTTPException(status_code=404, detail=f"Nodo '{node_name}' non trovato")
    reload_nodes()
    log_activity("admin", f"Nodo aggiornato: {node_name}", resource=f"node:{node_name}", severity="info")
    return {"success": True, "node": node}


@router.delete("/api/nodes/{node_name}")
async def delete_node(node_name: str, request: Request):
    """Delete a Proxmox node."""
    try:
        node = get_proxmox_node(node_name)
        if not node:
            raise HTTPException(status_code=404, detail=f"Nodo '{node_name}' non trovato")
        delete_proxmox_node(node_name)
        reload_nodes()
        log_activity("admin", f"Nodo eliminato: {node_name}", resource=f"node:{node_name}", severity="warning")
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        print(f"Error deleting node: {e}")
        raise HTTPException(status_code=500, detail=str(e))

