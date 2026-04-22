from fastapi import APIRouter, Request

from database import get_db, log_activity
from proxmox_client import cluster


router = APIRouter(tags=["alerts"])


@router.get("/api/alerts")
async def get_alerts(resolved: bool = False):
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT * FROM alerts WHERE resolved = %s
            ORDER BY timestamp DESC LIMIT 100
            """,
            (resolved,),
        ).fetchall()

        summary = cluster.get_cluster_summary()
        live_alerts = []
        for node in summary["nodes"]:
            if node["cpu_usage"] > 90:
                live_alerts.append(
                    {
                        "type": "cpu_high",
                        "severity": "critical",
                        "node": node["name"],
                        "value": node["cpu_usage"],
                        "message": f"CPU usage critical: {node['cpu_usage']}%",
                    }
                )
            elif node["cpu_usage"] > 75:
                live_alerts.append(
                    {
                        "type": "cpu_high",
                        "severity": "warning",
                        "node": node["name"],
                        "value": node["cpu_usage"],
                        "message": f"CPU usage high: {node['cpu_usage']}%",
                    }
                )
            if node["mem_percent"] > 90:
                live_alerts.append(
                    {
                        "type": "mem_high",
                        "severity": "critical",
                        "node": node["name"],
                        "value": node["mem_percent"],
                        "message": f"Memory usage critical: {node['mem_percent']}%",
                    }
                )
            if node["status"] == "offline":
                live_alerts.append(
                    {
                        "type": "node_offline",
                        "severity": "critical",
                        "node": node["name"],
                        "message": f"Node {node['name']} is offline!",
                    }
                )

        return {
            "alerts": [dict(r) for r in rows],
            "live_alerts": live_alerts,
            "count": len(rows) + len(live_alerts),
        }


@router.post("/api/alerts/{alert_id}/resolve")
async def resolve_alert(alert_id: int, request: Request):
    with get_db() as conn:
        conn.execute(
            """
            UPDATE alerts SET resolved = TRUE, resolved_at = NOW() WHERE id = %s
            """,
            (alert_id,),
        )
        conn.commit()
        log_activity(
            "admin",
            f"Alert {alert_id} resolved",
            ip_address=request.client.host if request.client else None,
        )
        return {"success": True}

