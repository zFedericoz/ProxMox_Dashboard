from fastapi import APIRouter, HTTPException, Request
from database import (
    get_clusters,
    get_cluster_by_id,
    create_cluster,
    update_cluster,
    delete_cluster,
    assign_node_to_cluster,
    get_proxmox_nodes_with_cluster,
    log_activity,
)
from proxmox_client import reload_nodes

router = APIRouter(tags=["clusters"])


@router.get("/api/clusters")
async def list_clusters():
    clusters = get_clusters()
    nodes = get_proxmox_nodes_with_cluster()
    # Attach nodes list to each cluster
    cluster_map = {c["id"]: {**c, "nodes": []} for c in clusters}
    standalone = []
    for n in nodes:
        cid = n.get("cluster_id")
        if cid and cid in cluster_map:
            cluster_map[cid]["nodes"].append(n)
        elif not cid:
            standalone.append(n)
    return {
        "clusters": list(cluster_map.values()),
        "standalone_nodes": standalone,
    }


@router.post("/api/clusters")
async def create_cluster_endpoint(request: Request):
    body = await request.json()
    name = body.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Il nome cluster è obbligatorio")
    description = body.get("description", "")
    cluster = create_cluster(name, description)
    if not cluster:
        raise HTTPException(status_code=409, detail=f"Cluster '{name}' già esistente")
    reload_nodes()
    log_activity("admin", f"Cluster creato: {name}", resource=f"cluster:{name}", severity="info")
    return {"success": True, "cluster": cluster}


@router.put("/api/clusters/{cluster_id}")
async def update_cluster_endpoint(cluster_id: int, request: Request):
    body = await request.json()
    updated = update_cluster(cluster_id, **body)
    if not updated:
        raise HTTPException(status_code=404, detail="Cluster non trovato")
    reload_nodes()
    log_activity("admin", f"Cluster aggiornato: {cluster_id}", resource=f"cluster:{cluster_id}", severity="info")
    return {"success": True, "cluster": updated}


@router.delete("/api/clusters/{cluster_id}")
async def delete_cluster_endpoint(cluster_id: int):
    ok = delete_cluster(cluster_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Cluster non trovato")
    reload_nodes()
    log_activity("admin", f"Cluster eliminato: {cluster_id}", resource=f"cluster:{cluster_id}", severity="warning")
    return {"success": True}


@router.put("/api/clusters/{cluster_id}/nodes/{node_name}")
async def add_node_to_cluster(cluster_id: int, node_name: str):
    cluster = get_cluster_by_id(cluster_id)
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster non trovato")
    ok = assign_node_to_cluster(node_name, cluster_id)
    if not ok:
        raise HTTPException(status_code=500, detail="Errore assegnazione nodo")
    reload_nodes()
    log_activity("admin", f"Nodo {node_name} assegnato a cluster {cluster['name']}", severity="info")
    return {"success": True}


@router.delete("/api/clusters/{cluster_id}/nodes/{node_name}")
async def remove_node_from_cluster(cluster_id: int, node_name: str):
    ok = assign_node_to_cluster(node_name, None)
    if not ok:
        raise HTTPException(status_code=500, detail="Errore rimozione nodo da cluster")
    reload_nodes()
    log_activity("admin", f"Nodo {node_name} rimosso dal cluster {cluster_id}", severity="info")
    return {"success": True}
