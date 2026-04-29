"""
Proxmox API client - connects to all nodes and collects metrics.

Performance design:
  - Refresh proattivo in background: le richieste leggono SEMPRE dalla cache (0ms attesa Proxmox).
  - Threading lock: un solo refresh alla volta, nessun thundering herd.
  - HTTP session con connection pool tuned per richieste parallele.
  - Cache unificata: un solo fetch per ciclo alimenta summary, vms e containers.
  - get_all_vms / get_all_containers non richiamano _ensure_fresh se la cache è già fresca.
  - save_metrics_snapshot usa cache diretta senza HTTP aggiuntivi.
"""
import json
import time
import threading
import urllib3
from datetime import datetime
from typing import Dict, List, Optional, Any
from concurrent.futures import ThreadPoolExecutor, as_completed, FIRST_COMPLETED
from concurrent.futures import wait
from requests.adapters import HTTPAdapter

from config import settings
from database import get_db, log_activity_async, get_cost_config, get_cost_config_nodes

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

CACHE_TTL      = 30   # secondi — leggermente più largo per ridurre refresh inutili
CACHE_TTL_SLOW = 60   # secondi — servizi, storage, tasks

_node_data_cache: Dict[str, Dict] = {}
_cluster_summary_cache = {"data": None, "ts": 0}
_services_cache        = {"data": None, "ts": 0}
_logs_cache            = {"data": None, "ts": 0}
_storage_cache         = {"data": None, "ts": 0}
_tasks_cache           = {"data": None, "ts": 0}

# Lock: garantisce che un solo thread alla volta esegua il refresh HTTP
_refresh_lock   = threading.Lock()
# Flag per skip immediato se il refresh è già in corso (non-blocking check)
_refresh_active = threading.Event()

_executor = ThreadPoolExecutor(max_workers=20, thread_name_prefix="pve")


def fix_quorum(node_host: str) -> tuple:
    """
    Esegue pvecm expected 1 via SSH sul nodo indicato.
    Usato per sbloccare il quorum quando uno o piu nodi del cluster sono offline.
    Restituisce (successo: bool, messaggio: str).
    """
    try:
        import paramiko
        ssh_user     = settings.PROXMOX_USER.split("@")[0]
        ssh_password = settings.PROXMOX_PASSWORD
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        client.connect(hostname=node_host, port=22, username=ssh_user,
                       password=ssh_password, timeout=10)
        _, stdout, stderr = client.exec_command("pvecm expected 1")
        out = stdout.read().decode().strip()
        err = stderr.read().decode().strip()
        client.close()
        if err and "expected" not in err.lower():
            return False, f"SSH fix_quorum error: {err}"
        return True, f"pvecm expected 1 su {node_host}: {out or 'OK'}"
    except Exception as e:
        return False, f"fix_quorum fallito su {node_host}: {e}"


def format_uptime(seconds: int) -> str:
    if not seconds:
        return "N/A"
    days  = seconds // 86400
    hours = (seconds % 86400) // 3600
    mins  = (seconds % 3600) // 60
    if days  > 0: return f"{days}d {hours}h {mins}m"
    if hours > 0: return f"{hours}h {mins}m"
    return f"{mins}m"


class ProxmoxNode:
    def __init__(self, name: str, host: str, port: int = 8006, timeout: int = 8, cluster: dict = None):
        import requests
        self.name     = name
        self.host     = host
        self.port     = port
        self.timeout  = timeout
        self.base_url = f"https://{host}:{port}/api2/json"
        self.ticket      = None
        self.csrf_token  = None
        self.connected   = False
        self.last_error  = None
        self.session = requests.Session()
        self.session.verify = settings.PROXMOX_VERIFY_SSL
        self.cluster = cluster
        _adapter = HTTPAdapter(
            pool_connections=4,
            pool_maxsize=10,
            max_retries=0,
        )
        self.session.mount("https://", _adapter)
        self.session.mount("http://",  _adapter)

    def _auth_header(self) -> dict:
        token_name = self.cluster.get("token_name") if self.cluster else None
        token_value = self.cluster.get("token_value") if self.cluster else None
        if token_name and token_value:
            return {"Authorization":
                    f"PVEAPIToken={settings.PROXMOX_USER}!"
                    f"{token_name}={token_value}"}
        if self.ticket:
            return {"Cookie": f"PVEAuthCookie={self.ticket}",
                    "CSRFPreventionToken": self.csrf_token or ""}
        return {}

    def authenticate(self) -> bool:
        try:
            token_name = self.cluster.get("token_name") if self.cluster else None
            token_value = self.cluster.get("token_value") if self.cluster else None
            if token_name and token_value:
                self.connected = True
                return True
            resp = self.session.post(
                f"{self.base_url}/access/ticket",
                data={"username": settings.PROXMOX_USER,
                      "password": settings.PROXMOX_PASSWORD},
                timeout=self.timeout
            )
            if resp.status_code == 200:
                data = resp.json()["data"]
                self.ticket     = data["ticket"]
                self.csrf_token = data["CSRFPreventionToken"]
                self.connected  = True
                self.last_error = None
                return True
            self.last_error = f"Auth failed: {resp.status_code}"
            self.connected  = False
            return False
        except Exception as e:
            self.last_error = str(e)
            self.connected  = False
            return False

    def _get(self, path: str, params: dict = None) -> Optional[Any]:
        try:
            resp = self.session.get(
                f"{self.base_url}{path}",
                headers=self._auth_header(),
                params=params,
                timeout=self.timeout
            )
            if resp.status_code == 401:
                if self.authenticate():
                    resp = self.session.get(
                        f"{self.base_url}{path}",
                        headers=self._auth_header(),
                        params=params,
                        timeout=self.timeout
                    )
            if resp.status_code == 200:
                return resp.json().get("data")
            return None
        except Exception as e:
            self.last_error = str(e)
            return None

    def _post(self, path: str, data: dict = None) -> Optional[Any]:
        try:
            headers = self._auth_header()
            if self.csrf_token and "Cookie" in headers:
                headers["CSRFPreventionToken"] = self.csrf_token
            resp = self.session.post(
                f"{self.base_url}{path}",
                headers=headers,
                data=data or {},
                timeout=15
            )
            if resp.status_code == 401:
                if self.authenticate():
                    headers = self._auth_header()
                    if self.csrf_token and "Cookie" in headers:
                        headers["CSRFPreventionToken"] = self.csrf_token
                    resp = self.session.post(
                        f"{self.base_url}{path}",
                        headers=headers,
                        data=data or {},
                        timeout=15
                    )
            if resp.status_code in (200, 201, 202):
                return resp.json().get("data")
            try:   detail = resp.json()
            except Exception: detail = resp.text[:300]
            self.last_error = f"POST {path} failed: {resp.status_code} {detail}"
            return None
        except Exception as e:
            self.last_error = str(e)
            return None

    # ── API shortcuts ──────────────────────────────────────────────────────
    def get_node_status(self)          -> Optional[Dict]: return self._get(f"/nodes/{self.name}/status")
    def get_node_rrd(self, tf="hour")  -> Optional[List]: return self._get(f"/nodes/{self.name}/rrddata", {"timeframe": tf, "cf": "AVERAGE"})
    def get_vms(self)                  -> List[Dict]:     return self._get(f"/nodes/{self.name}/qemu") or []
    def get_containers(self)           -> List[Dict]:     return self._get(f"/nodes/{self.name}/lxc")  or []
    def get_vm_status(self, vmid: int) -> Optional[Dict]: return self._get(f"/nodes/{self.name}/qemu/{vmid}/status/current")
    def get_storage(self)              -> List[Dict]:     return self._get(f"/nodes/{self.name}/storage") or []
    def get_tasks(self, limit=50)      -> List[Dict]:     return self._get(f"/nodes/{self.name}/tasks", {"limit": limit}) or []
    def get_services(self)           -> List[Dict]:     return self._get(f"/nodes/{self.name}/services") or []
    def get_syslog(self, limit=100)  -> List[Dict]:     return self._get(f"/nodes/{self.name}/syslog", {"limit": limit}) or []
    def get_network(self)            -> List[Dict]:     return self._get(f"/nodes/{self.name}/network") or []
    def get_disks(self)              -> List[Dict]:     return self._get(f"/nodes/{self.name}/disks/list") or []
    def get_cluster_resources(self)  -> List[Dict]:     return self._get("/cluster/resources") or []
    
    def get_cluster_status(self)     -> Dict:         return self._get("/cluster/status") or {}
    def get_cluster_ha_status(self)   -> Dict:         return self._get("/cluster/ha/status") or {}
    def get_cluster_config(self)      -> Dict:         return self._get("/cluster/config") or {}

    def vm_action(self, vmid: int, action: str) -> Optional[Any]:
        return self._post(f"/nodes/{self.name}/qemu/{vmid}/status/{action}")

    def ct_action(self, vmid: int, action: str) -> Optional[Any]:
        return self._post(f"/nodes/{self.name}/lxc/{vmid}/status/{action}")

    def vm_status(self, vmid: int) -> Optional[Dict]:
        return self._get(f"/nodes/{self.name}/qemu/{vmid}/status/current")

    def ct_status(self, vmid: int) -> Optional[Dict]:
        return self._get(f"/nodes/{self.name}/lxc/{vmid}/status/current")

    def get_snapshots(self, vmid: int, vtype: str = "qemu") -> List[Dict]:
        return self._get(f"/nodes/{self.name}/{vtype}/{vmid}/snapshot") or []

    def create_snapshot(self, vmid: int, snapname: str, vtype: str = "qemu", description: str = "") -> Optional[Any]:
        return self._post(f"/nodes/{self.name}/{vtype}/{vmid}/snapshot", {
            "snapname": snapname,
            "description": description,
            "vmstate": 1
        })

    def delete_snapshot(self, vmid: int, snapname: str, vtype: str = "qemu") -> Optional[Any]:
        return self._post(f"/nodes/{self.name}/{vtype}/{vmid}/snapshot/{snapname}/delete")

    def restore_snapshot(self, vmid: int, snapname: str, vtype: str = "qemu", start: bool = False) -> Optional[Any]:
        return self._post(f"/nodes/{self.name}/{vtype}/{vmid}/snapshot/{snapname}/rollback")

    def migrate_vm(self, vmid: int, target: str, online: bool = True) -> Optional[Any]:
        return self._post(f"/nodes/{self.name}/qemu/{vmid}/migrate", {
            "target": target,
            "online": 1 if online else 0
        })

    def migrate_ct(self, vmid: int, target: str, online: bool = True) -> Optional[Any]:
        return self._post(f"/nodes/{self.name}/lxc/{vmid}/migrate", {
            "target": target,
            "online": 1 if online else 0
        })

    def create_backup(self, vmid: int, storage: str, mode: str = "snapshot", vtype: str = "qemu") -> Optional[Any]:
        return self._post(f"/nodes/{self.name}/{vtype}/{vmid}/backup", {
            "storage": storage,
            "mode": mode,
            "compress": "zstd",
            "notification": "always"
        })

    def get_backup_jobs(self) -> List[Dict]:
        return self._get("/cluster/backup") or []

    def get_backup_logs(self, vmid: Optional[int] = None, limit: int = 50) -> List[Dict]:
        return self._get("/cluster/log", {"limit": limit}) or []

    def fetch_all(self) -> Dict:
        """Fetcha status + vms + containers in parallelo per questo nodo."""
        if not self.connected:
            self.authenticate()

        node_info = {
            "name": self.name, "host": self.host, "status": "offline",
            "cpu_usage": 0, "mem_used_gb": 0, "mem_total_gb": 0,
            "mem_percent": 0, "disk_used_gb": 0, "disk_total_gb": 0,
            "disk_percent": 0, "cpu_cores": 0, "uptime": 0,
            "uptime_str": "N/A", "vm_count": 0, "ct_count": 0,
            "kernel": "", "load_avg": [0, 0, 0], "error": self.last_error,
            "_vms": [], "_cts": []
        }

        if not self.connected:
            return node_info

        f_status = _executor.submit(self.get_node_status)
        f_vms    = _executor.submit(self.get_vms)
        f_cts    = _executor.submit(self.get_containers)

        status, vms, cts = None, [], []
        for f in as_completed([f_status, f_vms, f_cts], timeout=self.timeout + 2):
            try:
                result = f.result()
                if   f is f_status: status = result
                elif f is f_vms:    vms    = result or []
                elif f is f_cts:    cts    = result or []
            except Exception:
                pass

        if status:
            node_info["status"]    = "online"
            node_info["cpu_usage"] = round(status.get("cpu", 0) * 100, 1)
            mem = status.get("memory", {})
            dsk = status.get("rootfs", {})
            mt, mu = mem.get("total", 0), mem.get("used", 0)
            dt, du = dsk.get("total", 0), dsk.get("used", 0)
            node_info["mem_total_gb"]  = round(mt / (1024**3), 2)
            node_info["mem_used_gb"]   = round(mu / (1024**3), 2)
            node_info["mem_percent"]   = round(mu / mt * 100, 1) if mt else 0
            node_info["disk_total_gb"] = round(dt / (1024**3), 2)
            node_info["disk_used_gb"]  = round(du / (1024**3), 2)
            node_info["disk_percent"]  = round(du / dt * 100, 1) if dt else 0
            node_info["cpu_cores"]     = status.get("cpuinfo", {}).get("cpus", 0)
            node_info["uptime"]        = status.get("uptime", 0)
            node_info["uptime_str"]    = format_uptime(status.get("uptime", 0))
            node_info["kernel"]        = status.get("kversion", "")
            node_info["load_avg"]      = status.get("loadavg", [0, 0, 0])
            node_info["error"]         = None

        for vm in vms: vm["node"] = self.name; vm["node_ip"] = self.host; vm["type"] = "vm"
        for ct in cts: ct["node"] = self.name; ct["node_ip"] = self.host; ct["type"] = "lxc"
        node_info["vm_count"] = len(vms)
        node_info["ct_count"] = len(cts)
        node_info["_vms"]     = vms
        node_info["_cts"]     = cts
        return node_info


class ProxmoxCluster:
    def __init__(self):
        self.nodes: Dict[str, ProxmoxNode] = {}
        self._active_cluster = None
        if settings.PROXMOX_CLUSTERS:
            self._active_cluster = settings.PROXMOX_CLUSTERS[0]
        if settings.PROXMOX_NODES:
            for nc in settings.PROXMOX_NODES:
                self.nodes[nc["name"]] = ProxmoxNode(
                    name    = nc["name"],
                    host    = nc["host"],
                    port    = nc.get("port", 8006),
                    timeout = nc.get("timeout", 8)
                )

    def get_active_cluster(self):
        """Return the active cluster config for token-based auth."""
        return self._active_cluster

    def discover_from_cluster(self):
        """Scopri nodi dal cluster Proxmox via API (autodiscovery)."""
        if not self.nodes:
            return
        
        first_node = next((n for n in self.nodes.values() if n.connected), None)
        if not first_node:
            return
        
        try:
            cluster_status = first_node.get_cluster_status()
            if "nodes" in cluster_status:
                discovered_nodes = {}
                for node in cluster_status.get("nodes", []):
                    node_name = node.get("node", "")
                    node_ip = node.get("ip", "")
                    
                    if node_name and node_ip:
                        if node_name not in self.nodes:
                            discovered_nodes[node_name] = ProxmoxNode(
                                name=node_name,
                                host=node_ip,
                                port=8006,
                                timeout=8
                            )
                        else:
                            self.nodes[node_name].host = node_ip
                            self.nodes[node_name].connected = True
                            discovered_nodes[node_name] = self.nodes[node_name]
                
                if discovered_nodes:
                    self.nodes.update(discovered_nodes)
                    print(f"🔍 Auto-discovered {len(discovered_nodes)} nodes from cluster")
        except Exception as e:
            print(f"⚠️ Cluster auto-discovery failed: {e}")

    def connect_all(self):
        if not self.nodes:
            return
        for name, node in self.nodes.items():
            try:
                ok = node.authenticate()
                print(f"  Node {name} ({node.host}): {'connected' if ok else 'failed'}")
                if not ok: print(f"    Error: {node.last_error}")
            except Exception as e:
                print(f"  Node {name}: connection error ({type(e).__name__})")
                node.connected = False

    def _refresh_node_data(self) -> None:
        """
        Aggiorna la cache dei nodi. Thread-safe: un solo refresh alla volta.
        Se un altro thread sta già refreshando, aspetta che finisca e ritorna
        (usa i dati appena aggiornati dall'altro thread).
        """
        global _node_data_cache, _cluster_summary_cache

        # Non-blocking: se il lock è già preso, aspetta e poi ritorna
        # (l'altro thread ha già aggiornato la cache)
        if not _refresh_lock.acquire(blocking=True, timeout=30):
            return  # timeout di sicurezza
        try:
            now = time.time()
            max_wait = max(n.timeout for n in self.nodes.values()) + 4 if self.nodes else 12

            futures = {_executor.submit(node.fetch_all): name for name, node in self.nodes.items()}
            done, _ = wait(futures, timeout=max_wait)

            new_cache: Dict[str, Dict] = {}
            for f in done:
                name = futures[f]
                try:
                    new_cache[name] = {"ts": now, **f.result()}
                except Exception as e:
                    new_cache[name] = _node_data_cache.get(name) or {
                        "ts": now, "name": name, "host": self.nodes[name].host,
                        "status": "offline", "cpu_usage": 0, "mem_used_gb": 0,
                        "mem_total_gb": 0, "mem_percent": 0, "disk_used_gb": 0,
                        "disk_total_gb": 0, "disk_percent": 0, "cpu_cores": 0,
                        "uptime": 0, "uptime_str": "N/A", "vm_count": 0, "ct_count": 0,
                        "kernel": "", "load_avg": [0, 0, 0], "error": str(e),
                        "_vms": [], "_cts": []
                    }

            for name in self.nodes:
                if name not in new_cache:
                    new_cache[name] = _node_data_cache.get(name) or {
                        "ts": now, "name": name, "host": self.nodes[name].host,
                        "status": "offline", "cpu_usage": 0, "mem_used_gb": 0,
                        "mem_total_gb": 0, "mem_percent": 0, "disk_used_gb": 0,
                        "disk_total_gb": 0, "disk_percent": 0, "cpu_cores": 0,
                        "uptime": 0, "uptime_str": "N/A", "vm_count": 0, "ct_count": 0,
                        "kernel": "", "load_avg": [0, 0, 0], "error": "timeout",
                        "_vms": [], "_cts": []
                    }

            _node_data_cache = new_cache
            _cluster_summary_cache = {"data": None, "ts": 0}
        finally:
            _refresh_lock.release()

    def _ensure_fresh(self) -> None:
        now = time.time()
        stale = any(
            name not in _node_data_cache or
            now - _node_data_cache[name].get("ts", 0) > CACHE_TTL
            for name in self.nodes
        )
        if stale:
            self._refresh_node_data()

    def _cache_is_fresh(self) -> bool:
        """True se la cache è valida per tutti i nodi."""
        now = time.time()
        return all(
            name in _node_data_cache and
            now - _node_data_cache[name].get("ts", 0) <= CACHE_TTL
            for name in self.nodes
        )

    def get_cluster_summary(self) -> Dict:
        global _cluster_summary_cache
        now = time.time()
        if _cluster_summary_cache["data"] and (now - _cluster_summary_cache["ts"]) < CACHE_TTL:
            return _cluster_summary_cache["data"]

        self._ensure_fresh()

        summary = {
            "nodes": [], "total_vms": 0, "total_containers": 0,
            "total_cpu_cores": 0, "total_mem_gb": 0, "total_disk_tb": 0,
            "used_cpu_percent": 0, "used_mem_percent": 0, "used_disk_percent": 0,
            "online_nodes": 0, "offline_nodes": 0,
            "timestamp": datetime.now().isoformat()
        }
        cpu_vals, mem_vals, disk_vals = [], [], []

        for name in self.nodes:
            d = _node_data_cache.get(name, {})
            node_info = {k: v for k, v in d.items() if not k.startswith("_") and k != "ts"}
            summary["nodes"].append(node_info)
            summary["total_vms"]        += d.get("vm_count", 0)
            summary["total_containers"] += d.get("ct_count", 0)
            if d.get("status") == "online":
                summary["online_nodes"]    += 1
                summary["total_cpu_cores"] += d.get("cpu_cores", 0)
                summary["total_mem_gb"]    += d.get("mem_total_gb", 0)
                summary["total_disk_tb"]   += d.get("disk_total_gb", 0) / 1024
                cpu_vals.append(d.get("cpu_usage", 0))
                mem_vals.append(d.get("mem_percent", 0))
                disk_vals.append(d.get("disk_percent", 0))
            else:
                summary["offline_nodes"] += 1

        if cpu_vals:  summary["used_cpu_percent"]  = round(sum(cpu_vals)  / len(cpu_vals),  1)
        if mem_vals:  summary["used_mem_percent"]  = round(sum(mem_vals)  / len(mem_vals),  1)
        if disk_vals: summary["used_disk_percent"] = round(sum(disk_vals) / len(disk_vals), 1)

        _cluster_summary_cache = {"data": summary, "ts": now}
        return summary

    def get_all_vms(self) -> List[Dict]:
        # Usa _ensure_fresh solo se la cache è davvero stale
        # (in /api/cluster/all viene chiamata dopo get_cluster_summary che ha già refreshato)
        if not self._cache_is_fresh():
            self._ensure_fresh()
        return [vm for d in _node_data_cache.values() for vm in d.get("_vms", [])]

    def get_all_containers(self) -> List[Dict]:
        if not self._cache_is_fresh():
            self._ensure_fresh()
        return [ct for d in _node_data_cache.values() for ct in d.get("_cts", [])]

    def get_all_tasks(self, limit: int = 100) -> List[Dict]:
        global _tasks_cache
        now = time.time()
        if _tasks_cache["data"] and (now - _tasks_cache["ts"]) < CACHE_TTL_SLOW:
            return _tasks_cache["data"]
        futures = {_executor.submit(node.get_tasks, limit): name
                   for name, node in self.nodes.items() if node.connected}
        all_tasks = []
        for f in as_completed(futures, timeout=15):
            name = futures[f]
            try:
                tasks = f.result() or []
                for t in tasks: t["node"] = name
                all_tasks.extend(tasks)
            except Exception: pass
        all_tasks.sort(key=lambda x: x.get("starttime", 0), reverse=True)
        result = all_tasks[:limit]
        _tasks_cache = {"data": result, "ts": now}
        return result

    def get_all_services(self) -> Dict[str, List]:
        global _services_cache
        now = time.time()
        if _services_cache["data"] and (now - _services_cache["ts"]) < CACHE_TTL_SLOW:
            return _services_cache["data"]
        futures = {_executor.submit(node.get_services): name
                   for name, node in self.nodes.items() if node.connected}
        all_services = {}
        for f in as_completed(futures, timeout=15):
            name = futures[f]
            try: all_services[name] = f.result() or []
            except Exception: all_services[name] = []
        _services_cache = {"data": all_services, "ts": now}
        return all_services

    def get_all_logs(self, limit: int = 200) -> List[Dict]:
        global _logs_cache
        now = time.time()
        if _logs_cache["data"] and (now - _logs_cache["ts"]) < CACHE_TTL:
            return _logs_cache["data"]
        futures = {_executor.submit(node.get_syslog, limit): name
                   for name, node in self.nodes.items() if node.connected}
        all_logs = []
        for f in as_completed(futures, timeout=15):
            name = futures[f]
            try:
                logs = f.result() or []
                for l in logs: l["node"] = name
                all_logs.extend(logs)
            except Exception: pass
        all_logs.sort(key=lambda x: x.get("t", 0), reverse=True)
        result = all_logs[:limit]
        _logs_cache = {"data": result, "ts": now}
        return result

    def get_storage_all(self) -> Dict[str, List]:
        global _storage_cache
        now = time.time()
        if _storage_cache["data"] and (now - _storage_cache["ts"]) < CACHE_TTL_SLOW:
            return _storage_cache["data"]
        futures = {_executor.submit(node.get_storage): name
                   for name, node in self.nodes.items() if node.connected}
        all_storage = {}
        for f in as_completed(futures, timeout=15):
            name = futures[f]
            try: all_storage[name] = f.result() or []
            except Exception: all_storage[name] = []
        _storage_cache = {"data": all_storage, "ts": now}
        return all_storage

    def get_vm_snapshots(self, node_name: str, vmid: int, vtype: str = "qemu") -> List[Dict]:
        if node_name not in self.nodes:
            return []
        try:
            return self.nodes[node_name].get_snapshots(vmid, vtype)
        except Exception:
            return []

    def create_vm_snapshot(self, node_name: str, vmid: int, snapname: str, vtype: str = "qemu", description: str = "") -> Optional[Any]:
        if node_name not in self.nodes:
            return None
        return self.nodes[node_name].create_snapshot(vmid, snapname, vtype, description)

    def delete_vm_snapshot(self, node_name: str, vmid: int, snapname: str, vtype: str = "qemu") -> Optional[Any]:
        if node_name not in self.nodes:
            return None
        return self.nodes[node_name].delete_snapshot(vmid, snapname, vtype)

    def restore_vm_snapshot(self, node_name: str, vmid: int, snapname: str, vtype: str = "qemu", start: bool = False) -> Optional[Any]:
        if node_name not in self.nodes:
            return None
        return self.nodes[node_name].restore_snapshot(vmid, snapname, vtype, start)

    def trigger_backup(self, node_name: str, vmid: int, storage: str, mode: str = "snapshot", vtype: str = "qemu") -> Optional[Any]:
        if node_name not in self.nodes:
            return None
        return self.nodes[node_name].create_backup(vmid, storage, mode, vtype)

    def get_backup_jobs(self) -> List[Dict]:
        all_jobs = []
        for node in self.nodes.values():
            if node.connected:
                try:
                    jobs = node.get_backup_jobs()
                    for job in jobs:
                        job["node"] = node.name
                    all_jobs.extend(jobs)
                except Exception:
                    pass
        return all_jobs

    def get_all_snapshots(self) -> Dict[str, List]:
        all_snapshots = {}
        for name, node in self.nodes.items():
            if node.connected:
                try:
                    vms = node.get_vms()
                    cts = node.get_containers()
                    snapshots = []
                    for vm in vms:
                        try:
                            vm_snaps = node.get_snapshots(vm.get("vmid"), "qemu")
                            for s in vm_snaps:
                                s["vmid"] = vm.get("vmid")
                                s["vm_name"] = vm.get("name", vm.get("vmid"))
                                s["vtype"] = "qemu"
                            snapshots.extend(vm_snaps)
                        except Exception:
                            pass
                    for ct in cts:
                        try:
                            ct_snaps = node.get_snapshots(ct.get("vmid"), "lxc")
                            for s in ct_snaps:
                                s["vmid"] = ct.get("vmid")
                                s["vm_name"] = ct.get("name", ct.get("vmid"))
                                s["vtype"] = "lxc"
                            snapshots.extend(ct_snaps)
                        except Exception:
                            pass
                    all_snapshots[name] = snapshots
                except Exception:
                    all_snapshots[name] = []
            else:
                all_snapshots[name] = []
        return all_snapshots

    def get_cluster_health(self) -> Dict:
        """Get cluster health status including HA, quorum, and issues."""
        health = {
            "status": "healthy",
            "quorum": False,
            "nodes": [],
            "ha_status": {"enabled": False, "resources": []},
            "issues": [],
            "warnings": []
        }
        
        try:
            first_node = next((n for n in self.nodes.values() if n.connected), None)
            if not first_node:
                health["status"] = "no_nodes"
                health["issues"].append({"severity": "critical", "message": "Nessun nodo connesso"})
                return health
            
            cluster_status = first_node.get_cluster_status()
            
            if "quorate" in cluster_status:
                health["quorum"] = cluster_status.get("quorate", False)
            
            if "nodes" in cluster_status:
                for node in cluster_status.get("nodes", []):
                    node_info = {
                        "name": node.get("node", "unknown"),
                        "online": node.get("online", 0) == 1,
                        "ip": node.get("ip", ""),
                        "level": node.get("level", ""),
                        "local": node.get("local", 0) == 1
                    }
                    health["nodes"].append(node_info)
            
            if not health["quorum"]:
                health["issues"].append({
                    "severity": "critical",
                    "type": "quorum",
                    "message": "Quorum del cluster perso - decisioni cluster bloccate",
                    "suggestion": "Verificare connettività di rete tra nodi"
                })
            
            for node in health["nodes"]:
                if not node["online"]:
                    health["issues"].append({
                        "severity": "critical",
                        "type": "node_offline",
                        "message": f"Nodo {node['name']} offline",
                        "node": node["name"]
                    })
            
            try:
                ha_status = first_node.get_cluster_ha_status()
                if ha_status:
                    health["ha_status"] = {
                        "enabled": True,
                        "status": ha_status.get("status", "unknown"),
                        "resources": ha_status.get("resources", [])
                    }
                    
                    for res in ha_status.get("resources", []):
                        state = res.get("state", "")
                        if state != "running":
                            health["warnings"].append({
                                "severity": "warning",
                                "type": "ha",
                                "message": f"HA resource {res.get('sid', 'unknown')} in stato: {state}",
                                "resource": res.get("sid", "")
                            })
            except Exception:
                pass
            
            for name, d in _node_data_cache.items():
                if d.get("status") == "online":
                    if d.get("disk_percent", 0) > 90:
                        health["issues"].append({
                            "severity": "critical",
                            "type": "disk_full",
                            "message": f"Disco nodo {name} al {d['disk_percent']}%",
                            "node": name
                        })
                    elif d.get("disk_percent", 0) > 80:
                        health["warnings"].append({
                            "severity": "warning",
                            "type": "disk_space",
                            "message": f"Disco nodo {name} al {d['disk_percent']}%",
                            "node": name
                        })
                    
                    if d.get("mem_percent", 0) > 95:
                        health["warnings"].append({
                            "severity": "warning",
                            "type": "memory",
                            "message": f"RAM nodo {name} al {d['mem_percent']}%",
                            "node": name
                        })
            
            if health["issues"]:
                health["status"] = "critical"
            elif health["warnings"]:
                health["status"] = "warning"
                
        except Exception as e:
            health["status"] = "error"
            health["issues"].append({"severity": "critical", "message": f"Errore lettura cluster: {e}"})
        
        return health

    def get_drs_recommendations(self) -> Dict:
        """
        DRS - Distributed Resource Scheduler
        Calcola raccomandazioni per bilanciamento carico cluster.
        """
        recommendations = {
            "enabled": False,
            "recommendations": [],
            "nodes": [],
            "metrics": {}
        }
        
        if len(self.nodes) < 2:
            recommendations["message"] = "DRS richiede almeno 2 nodi"
            return recommendations
        
        recommendations["enabled"] = True
        
        for name, d in _node_data_cache.items():
            if d.get("status") != "online":
                continue
                
            cpu_score = 100 - min(d.get("cpu_usage", 0), 100)
            mem_score = 100 - min(d.get("mem_percent", 0), 100)
            disk_score = 100 - min(d.get("disk_percent", 0), 100)
            
            balance_score = (cpu_score * 0.4) + (mem_score * 0.4) + (disk_score * 0.2)
            
            recommendations["nodes"].append({
                "name": name,
                "cpu_usage": d.get("cpu_usage", 0),
                "mem_percent": d.get("mem_percent", 0),
                "disk_percent": d.get("disk_percent", 0),
                "vm_count": d.get("vm_count", 0),
                "ct_count": d.get("ct_count", 0),
                "balance_score": round(balance_score, 1),
                "status": "balanced" if balance_score > 60 else "imbalanced" if balance_score < 40 else "normal"
            })
            
            recommendations["metrics"][name] = {
                "cpu_score": cpu_score,
                "mem_score": mem_score,
                "disk_score": disk_score,
                "balance_score": balance_score
            }
        
        recommendations["nodes"].sort(key=lambda x: x["balance_score"], reverse=True)
        
        if len(recommendations["nodes"]) >= 2:
            worst = recommendations["nodes"][-1]
            best = recommendations["nodes"][0]
            
            if worst["balance_score"] < 40 and best["balance_score"] > 60:
                recommendations["recommendations"].append({
                    "type": "rebalance",
                    "priority": "high",
                    "message": f"Nodes sbilanciati: {worst['name']} (score {worst['balance_score']}) vs {best['name']} (score {best['balance_score']})",
                    "from_node": worst["name"],
                    "to_node": best["name"],
                    "action": "Migrazione VM da nodo sovraccarico a nodo sottoutilizzato"
                })
            
            if worst["cpu_usage"] > 80 and best["cpu_usage"] < 40:
                recommendations["recommendations"].append({
                    "type": "cpu_balance",
                    "priority": "medium",
                    "message": f"CPU sbilanciata: {worst['name']} {worst['cpu_usage']}% vs {best['name']} {best['cpu_usage']}%",
                    "from_node": worst["name"],
                    "to_node": best["name"]
                })
            
            if worst["mem_percent"] > 85 and best["mem_percent"] < 50:
                recommendations["recommendations"].append({
                    "type": "memory_balance",
                    "priority": "medium",
                    "message": f"RAM sbilanciata: {worst['name']} {worst['mem_percent']}% vs {best['name']} {best['mem_percent']}%",
                    "from_node": worst["name"],
                    "to_node": best["name"]
                })
        
        return recommendations

    def get_vm_placement_suggestion(self, vm_vmid: int = None, vm_type: str = "qemu") -> Dict:
        """Suggerisce il nodo migliore per una nuova VM o per una VM specifica."""
        suggestions = {
            "current": None,
            "recommended": None,
            "nodes": []
        }
        
        node_scores = []
        
        for name, d in _node_data_cache.items():
            if d.get("status") != "online":
                continue
            
            cpu_available = 100 - d.get("cpu_usage", 0)
            mem_available = 100 - d.get("mem_percent", 0)
            disk_available = 100 - d.get("disk_percent", 0)
            
            score = (cpu_available * 0.3) + (mem_available * 0.4) + (disk_available * 0.3)
            
            node_scores.append({
                "name": name,
                "score": round(score, 1),
                "cpu_available": round(cpu_available, 1),
                "mem_available": round(mem_available, 1),
                "disk_available": round(disk_available, 1),
                "current_vm_count": d.get("vm_count", 0) + d.get("ct_count", 0)
            })
        
        node_scores.sort(key=lambda x: x["score"], reverse=True)
        
        suggestions["nodes"] = node_scores
        if node_scores:
            suggestions["recommended"] = node_scores[0]
            suggestions["recommended"]["reason"] = "Miglior bilanciamento risorse"
        
        return suggestions

    def save_metrics_snapshot(self):
        """
        Salva snapshot usando la cache esistente — zero chiamate HTTP.
        Chiamato DOPO _refresh_node_data, quindi la cache è garantita fresca.
        """
        try:
            conn = get_db()
            for name, d in _node_data_cache.items():
                if d.get("status") == "online":
                    conn.execute("""
                        INSERT INTO metrics_snapshots
                        (node_name, node_ip, cpu_usage, mem_used, mem_total,
                         disk_used, disk_total, uptime, load_avg, vm_count, ct_count, status)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, (
                        name, d.get("host", ""),
                        d.get("cpu_usage", 0),
                        round(d.get("mem_used_gb",   0) * (1024**3)),
                        round(d.get("mem_total_gb",  0) * (1024**3)),
                        round(d.get("disk_used_gb",  0) * (1024**3)),
                        round(d.get("disk_total_gb", 0) * (1024**3)),
                        d.get("uptime", 0),
                        json.dumps(d.get("load_avg", [])),
                        d.get("vm_count", 0), d.get("ct_count", 0), "online"
                    ))
                else:
                    host = self.nodes[name].host if name in self.nodes else ""
                    conn.execute(
                        "INSERT INTO metrics_snapshots (node_name, node_ip, status) VALUES (%s, %s, %s)",
                        (name, host, "offline")
                    )
            conn.commit()
        except Exception as e:
            print(f"Error saving metrics: {e}")
        finally:
            try:
                conn.close()
            except Exception:
                pass

    def invalidate_cache(self):
        """Invalida la cache dei nodi (usato dopo power actions)."""
        global _cluster_summary_cache
        for v in _node_data_cache.values():
            v["ts"] = 0
        _cluster_summary_cache = {"data": None, "ts": 0}

    def calculate_costs(self) -> Dict:
        cfg        = get_cost_config()
        node_cfgs  = get_cost_config_nodes()
        summary    = self.get_cluster_summary()

        kwh_price      = cfg.get("electricity_cost_kwh",          settings.ELECTRICITY_COST_KWH)
        cooling_pct    = cfg.get("cooling_overhead_pct",          settings.COOLING_OVERHEAD_PCT) / 100.0
        connectivity   = cfg.get("monthly_connectivity",          settings.MONTHLY_CONNECTIVITY)
        sub_per_node   = cfg.get("proxmox_subscription_per_node", settings.PROXMOX_SUBSCRIPTION_PER_NODE)
        backup_offsite = cfg.get("monthly_backup_offsite",        settings.MONTHLY_BACKUP_OFFSITE)
        monthly_budget = cfg.get("monthly_budget",                settings.MONTHLY_BUDGET)

        node_costs, total_kwh, total_amort, total_sub = [], 0.0, 0.0, 0.0

        for ni in summary["nodes"]:
            name = ni["name"]
            nc   = node_cfgs.get(name, {})
            tdp_idle     = nc.get("tdp_idle_w",          settings.NODE_TDP_IDLE_W)
            tdp_max      = nc.get("tdp_max_w",           settings.NODE_TDP_MAX_W)
            hours        = nc.get("hours_per_month",     settings.NODE_HOURS_PER_MONTH)
            hw_cost      = nc.get("hardware_cost",       settings.HARDWARE_COST_PER_NODE)
            amort_months = nc.get("amortization_months", settings.HARDWARE_AMORTIZATION_MONTHS)

            cpu_pct  = ni.get("cpu_usage", 0) / 100.0
            watt     = tdp_idle + cpu_pct * (tdp_max - tdp_idle)
            kwh      = watt * hours / 1000.0
            e_cost   = round(kwh * kwh_price, 2)
            total_kwh += kwh
            amort    = round(hw_cost / amort_months, 2) if amort_months > 0 else 0.0
            total_amort += amort
            sub      = round(sub_per_node, 2)
            total_sub += sub
            node_costs.append({
                "name": name, "status": ni.get("status", "offline"),
                "cpu_usage_pct": ni.get("cpu_usage", 0),
                "watt_estimated": round(watt, 1), "kwh_month": round(kwh, 2),
                "electricity_cost": e_cost, "amortization": amort, "subscription": sub,
                "total": round(e_cost + amort + sub, 2),
                "tdp_idle_w": tdp_idle, "tdp_max_w": tdp_max,
                "hours_per_month": hours, "hardware_cost": hw_cost,
                "amortization_months": amort_months,
            })

        elec_total  = round(total_kwh * kwh_price, 2)
        cool_total  = round(elec_total * cooling_pct, 2)
        grand_total = round(elec_total + cool_total + connectivity + backup_offsite + total_amort + total_sub, 2)
        pct_used    = round(grand_total / monthly_budget * 100, 1) if monthly_budget > 0 else 0.0

        tips = []
        if summary["used_cpu_percent"] < 15:
            tips.append({"type":"cpu","severity":"warning","message":f"CPU al {summary['used_cpu_percent']}% — nodi sotto-utilizzati."})
        if summary["used_mem_percent"] < 25:
            tips.append({"type":"memory","severity":"warning","message":f"RAM al {summary['used_mem_percent']}% — possibile sovra-allocazione."})
        if summary["used_disk_percent"] > 80:
            tips.append({"type":"storage","severity":"critical","message":f"Disco al {summary['used_disk_percent']}% — espansione necessaria."})
        if summary["offline_nodes"] > 0:
            tips.append({"type":"availability","severity":"critical","message":f"{summary['offline_nodes']} nodo/i offline."})
        if pct_used > 90:
            tips.append({"type":"budget","severity":"critical","message":f"Budget al {pct_used}% — rischio sforamento."})
        elif pct_used > 75:
            tips.append({"type":"budget","severity":"warning","message":f"Budget al {pct_used}% — monitorare i consumi."})

        return {
            "nodes": node_costs,
            "breakdown": {
                "electricity": elec_total, "cooling": cool_total,
                "connectivity": round(connectivity,2), "backup": round(backup_offsite,2),
                "amortization": round(total_amort,2), "subscription": round(total_sub,2),
            },
            "total_monthly": grand_total, "budget": monthly_budget,
            "budget_used_percent": pct_used,
            "budget_remaining": round(monthly_budget - grand_total, 2),
            "total_kwh_month": round(total_kwh, 2),
            "electricity_cost_kwh": kwh_price,
            "optimization_tips": tips,
            "config": {
                "electricity_cost_kwh": kwh_price,
                "cooling_overhead_pct": cfg.get("cooling_overhead_pct", settings.COOLING_OVERHEAD_PCT),
                "monthly_connectivity": connectivity,
                "proxmox_subscription_per_node": sub_per_node,
                "monthly_backup_offsite": backup_offsite,
                "monthly_budget": monthly_budget,
            }
        }


cluster = ProxmoxCluster()


def reload_nodes():
    """
    Ricarica i nodi dal database e reconnette.
    Chiamato dopo CRUD su proxmox_nodes.
    """
    global cluster
    from database import get_proxmox_nodes
    nodes_db = get_proxmox_nodes(enabled_only=True)
    
    # Ricarica i nodi esistenti
    new_nodes = {}
    for nc in nodes_db:
        name = nc["name"]
        if name in cluster.nodes:
            # Aggiorna i parametri del nodo esistente
            old_node = cluster.nodes[name]
            old_node.host = nc["host"]
            old_node.port = nc["port"]
            old_node.timeout = nc["timeout"]
            old_node.base_url = f"https://{nc['host']}:{nc['port']}/api2/json"
            new_nodes[name] = old_node
        else:
            # Crea nuovo nodo
            new_nodes[name] = ProxmoxNode(
                name=nc["name"],
                host=nc["host"],
                port=nc["port"],
                timeout=nc["timeout"]
            )
    
    # Rimuovi nodi non più presenti
    for name in list(cluster.nodes.keys()):
        if name not in new_nodes:
            del cluster.nodes[name]
    
    cluster.nodes = new_nodes
    
    # Reconnect
    cluster.connect_all()
    
    # Invalida cache
    cluster.invalidate_cache()


def init_cluster_from_db():
    """Inizializza il cluster leggendo i nodi dal database."""
    from database import get_proxmox_nodes, init_db
    init_db()
    nodes_db = get_proxmox_nodes(enabled_only=True)
    
    cluster.nodes = {}
    for nc in nodes_db:
        cluster.nodes[nc["name"]] = ProxmoxNode(
            name=nc["name"],
            host=nc["host"],
            port=nc["port"],
            timeout=nc["timeout"]
        )
    
    if cluster.nodes:
        print(f"📡 Loaded {len(cluster.nodes)} nodes from database")
        cluster.connect_all()
        if cluster.nodes:
            cluster.discover_from_cluster()
