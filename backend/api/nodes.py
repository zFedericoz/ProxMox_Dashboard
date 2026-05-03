import json

from fastapi import APIRouter, HTTPException, Request
from starlette.requests import ClientDisconnect

from proxmoxer import ProxmoxAPI, AuthenticationError, ResourceException

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
    If Proxmox is unreachable, returns empty list (validation skipped).
    Always authenticates as root@pam via username/password.
    """
    try:
        proxmox = ProxmoxAPI(
            host,
            port=port,
            user="root@pam",
            password=settings.PROXMOX_PASSWORD,
            verify_ssl=bool(settings.PROXMOX_VERIFY_SSL),
            timeout=timeout,
        )
        data = proxmox.nodes.get()
        return [n.get("node") for n in (data or []) if n.get("node")]
    except (AuthenticationError, ResourceException) as e:
        if e.status_code == 401:
            raise HTTPException(status_code=401, detail="Credenziali Proxmox non valide (401)")
        return []
    except Exception:
        return []


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

    # Verify Proxmox is reachable and credentials are valid.
    # The node name provided by the user is used as-is (display name in dashboard).
    # If Proxmox is unreachable, skip validation and allow adding node anyway.
    api_names = _fetch_cluster_node_names(host, int(port), int(timeout))
    # api_names is only used to confirm connectivity; we don't enforce name matching
    # since the user-provided name is a dashboard label, not necessarily the PVE node name.

    node = create_proxmox_node(name, host, port, timeout, zone)
    reload_nodes()
    log_activity("admin", f"Nodo creato: {name}", resource=f"node:{name}", severity="info")
    return {"success": True, "node": node}


@router.put("/api/nodes/{node_name}")
async def update_node(node_name: str, request: Request):
    """Update a Proxmox node."""
    body = await request.json()
    if "enabled" in body:
        v = body.get("enabled")
        if isinstance(v, str):
            v = v.strip().lower()
            if v in {"1", "true", "yes", "y", "on"}:
                body["enabled"] = True
            elif v in {"0", "false", "no", "n", "off"}:
                body["enabled"] = False
        elif isinstance(v, (int, float)):
            body["enabled"] = bool(v)
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
