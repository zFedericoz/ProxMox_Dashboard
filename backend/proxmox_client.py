"""
Proxmox API client - connects to all nodes and collects metrics.

Uses proxmoxer for Proxmox API communication.

Performance design:
  - Refresh proattivo in background: le richieste leggono SEMPRE dalla cache (0ms attesa Proxmox).
  - Threading lock: un solo refresh alla volta, nessun thundering herd.
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
from concurrent.futures import ThreadPoolExecutor, as_completed, wait

from proxmoxer import ProxmoxAPI, AuthenticationError, ResourceException

from config import settings
from database import get_db, log_activity_async, get_cost_config, get_cost_config_nodes

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

CACHE_TTL      = 30
CACHE_TTL_SLOW = 60

_node_data_cache: Dict[str, Dict] = {}
_cluster_summary_cache = {"data": None, "ts": 0}
_services_cache        = {"data": None, "ts": 0}
_logs_cache            = {"data": None, "ts": 0}
_storage_cache         = {"data": None, "ts": 0}
_tasks_cache           = {"data": None, "ts": 0}

_refresh_lock   = threading.Lock()
_refresh_active = threading.Event()

_executor = ThreadPoolExecutor(max_workers=20, thread_name_prefix="pve")


def fix_quorum(node_host: str) -> tuple:
    """
    Esegue pvecm expected 1 via SSH sul nodo indicato.
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
        self.name     = name
        self.host     = host
        self.port     = port
        self.timeout  = timeout
        self.connected   = False
        self.last_error  = None
        self.cluster = cluster
        self._proxmox: Optional[ProxmoxAPI] = None

    def _build_client(self) -> ProxmoxAPI:
        token_name = self.cluster.get("token_name") if self.cluster else None
        token_value = self.cluster.get("token_value") if self.cluster else None

        common = {
            "verify_ssl": settings.PROXMOX_VERIFY_SSL,
            "timeout": self.timeout,
        }

        if token_name and token_value:
            return ProxmoxAPI(
                self.host,
                port=self.port,
                user=settings.PROXMOX_USER,
                token_name=token_name,
                token_value=token_value,
                **common,
            )
        return ProxmoxAPI(
            self.host,
            port=self.port,
            user=settings.PROXMOX_USER,
            password=settings.PROXMOX_PASSWORD,
            **common,
        )

    def authenticate(self) -> bool:
        try:
            self._proxmox = self._build_client()
            self.connected = True
            self.last_error = None
            return True
        except (AuthenticationError, ResourceException) as e:
            self.last_error = f"Auth failed: {e}"
            self.connected = False
            return False
        except Exception as e:
            self.last_error = str(e)
            self.connected = False
            return False

    def _safe_call(self, func):
        """Wraps a proxmoxer call with error handling and 401 retry."""
        try:
            return func()
        except ResourceException as e:
            if e.status_code == 401:
                try:
                    self._proxmox = self._build_client()
                    return func()
                except Exception:
                    self.last_error = str(e)
                    return None
            self.last_error = str(e)
            return None
        except Exception as e:
            self.last_error = str(e)
            return None

    # ── API shortcuts ──────────────────────────────────────────────────────
    def get_node_status(self)          -> Optional[Dict]:
        return self._safe_call(lambda: self._proxmox.nodes(self.name).status.get())

    def get_node_rrd(self, tf="hour")  -> Optional[List]:
        return self._safe_call(lambda: self._proxmox.nodes(self.name).rrddata.get(timeframe=tf, cf="AVERAGE"))

    def get_vms(self)                  -> List[Dict]:
        result = self._safe_call(lambda: self._proxmox.nodes(self.name).qemu.get())
        return result or []

    def get_containers(self)           -> List[Dict]:
        result = self._safe_call(lambda: self._proxmox.nodes(self.name).lxc.get())
        return result or []

    def get_vm_status(self, vmid: int) -> Optional[Dict]:
        return self._safe_call(lambda: self._proxmox.nodes(self.name).qemu(vmid).status.current.get())

    def get_storage(self)              -> List[Dict]:
        result = self._safe_call(lambda: self._proxmox.nodes(self.name).storage.get())
        return result or []

    def get_tasks(self, limit=50)      -> List[Dict]:
        result = self._safe_call(lambda: self._proxmox.nodes(self.name).tasks.get(limit=limit))
        return result or []

    def get_services(self)             -> List[Dict]:
        result = self._safe_call(lambda: self._proxmox.nodes(self.name).services.get())
        return result or []

    def get_syslog(self, limit=100)    -> List[Dict]:
        result = self._safe_call(lambda: self._proxmox.nodes(self.name).syslog.get(limit=limit))
        return result or []

    def get_network(self)              -> List[Dict]:
        result = self._safe_call(lambda: self._proxmox.nodes(self.name).network.get())
        return result or []

    def get_disks(self)                -> List[Dict]:
        result = self._safe_call(lambda: self._proxmox.nodes(self.name).disks.list.get())
        return result or []

    def get_cluster_resources(self)    -> List[Dict]:
        result = self._safe_call(lambda: self._proxmox.cluster.resources.get())
        return result or []

    def get_cluster_status(self)       -> Dict:
        result = self._safe_call(lambda: self._proxmox.cluster.status.get())
        return result or {}

    def get_cluster_ha_status(self)    -> Dict:
        result = self._safe_call(lambda: self._proxmox.cluster.ha.status.get())
        return result or {}

    def get_cluster_config(self)       -> Dict:
        result = self._safe_call(lambda: self._proxmox.cluster.config.get())
        return result or {}

    def vm_action(self, vmid: int, action: str) -> Optional[Any]:
        return self._safe_call(lambda: self._proxmox.nodes(self.name).qemu(vmid).status(action).post())

    def ct_action(self, vmid: int, action: str) -> Optional[Any]:
        return self._safe_call(lambda: self._proxmox.nodes(self.name).lxc(vmid).status(action).post())

    def vm_status(self, vmid: int) -> Optional[Dict]:
        return self._safe_call(lambda: self._proxmox.nodes(self.name).qemu(vmid).status.current.get())

    def ct_status(self, vmid: int) -> Optional[Dict]:
        return self._safe_call(lambda: self._proxmox.nodes(self.name).lxc(vmid).status.current.get())

    def get_snapshots(self, vmid: int, vtype: str = "qemu") -> List[Dict]:
        result = self._safe_call(lambda: self._proxmox.nodes(self.name)(vtype)(vmid).snapshot.get())
        return result or []

    def create_snapshot(self, vmid: int, snapname: str, vtype: str = "qemu", description: str = "") -> Optional[Any]:
        return self._safe_call(lambda: self._proxmox.nodes(self.name)(vtype)(vmid).snapshot.post(
            snapname=snapname, description=description, vmstate=1
        ))

    def delete_snapshot(self, vmid: int, snapname: str, vtype: str = "qemu") -> Optional[Any]:
        return self._safe_call(lambda: self._proxmox.nodes(self.name)(vtype)(vmid).snapshot(snapname).delete.post())

    def restore_snapshot(self, vmid: int, snapname: str, vtype: str = "qemu", start: bool = False) -> Optional[Any]:
        return self._safe_call(lambda: self._proxmox.nodes(self.name)(vtype)(vmid).snapshot(snapname).rollback.post())

    def migrate_vm(self, vmid: int, target: str, online: bool = True) -> Optional[Any]:
        return self._safe_call(lambda: self._proxmox.nodes(self.name).qemu(vmid).migrate.post(
            target=target, online=1 if online else 0
        ))

    def migrate_ct(self, vmid: int, target: str, online: bool = True) -> Optional[Any]:
        return self._safe_call(lambda: self._proxmox.nodes(self.name).lxc(vmid).migrate.post(
            target=target, online=1 if online else 0
        ))

    def create_backup(self, vmid: int, storage: str, mode: str = "snapshot", vtype: str = "qemu") -> Optional[Any]:
        return self._safe_call(lambda: self._proxmox.nodes(self.name).vzdump.post(
            vmid=vmid, storage=storage, mode=mode, compress="zstd", remove=0
        ))

    def get_backup_jobs(self) -> List[Dict]:
        result = self._safe_call(lambda: self._proxmox.cluster.backup.get())
        return result or []

    def get_backup_logs(self, vmid: Optional[int] = None, limit: int = 50) -> List[Dict]:
        params = {"limit": limit}
        if vmid:
            params["vmid"] = vmid
        result = self._safe_call(lambda: self._proxmox.cluster.log.get(**params))
        return result or []

    def get_pbs_backups(self, vmid: int, storage: str) -> List[Dict]:
        result = self._safe_call(
            lambda: self._proxmox.nodes(self.name).storage(storage).content.get(content="backup", vmid=vmid)
        )
        return result or []

    def delete_storage_content(self, storage: str, volid: str) -> Optional[Any]:
        return self._safe_call(
            lambda: self._proxmox.nodes(self.name).storage(storage).content(volid).delete()
        )

    def restore_from_backup(self, vmid: int, archive: str, target_storage: str, vtype: str = "qemu") -> Optional[Any]:
        return self._safe_call(
            lambda: self._proxmox.nodes(self.name)(vtype).post(
                vmid=vmid, archive=archive, storage=target_storage, force=1
            )
        )

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
        return self._active_cluster

    def discover_from_cluster(self):
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
                    print(f"Auto-discovered {len(discovered_nodes)} nodes from cluster")
        except Exception as e:
            print(f"Cluster auto-discovery failed: {e}")

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

    def init_empty_cache(self):
        """Inizializza la cache con dati offline per tutti i nodi (risposte immediate)."""
        now = time.time()
        for name, node in self.nodes.items():
            if name not in _node_data_cache:
                _node_data_cache[name] = {
                    "ts": now,
                    "name": name,
                    "host": node.host,
                    "status": "offline",
                    "cpu_usage": 0, "mem_used_gb": 0, "mem_total_gb": 0,
                    "mem_percent": 0, "disk_used_gb": 0, "disk_total_gb": 0,
                    "disk_percent": 0, "cpu_cores": 0, "uptime": 0,
                    "uptime_str": "N/A", "vm_count": 0, "ct_count": 0,
                    "kernel": "", "load_avg": [0, 0, 0],
                    "error": "Connessione in corso...",
                    "_vms": [], "_cts": []
                }

    def _refresh_node_data(self) -> None:
        global _node_data_cache, _cluster_summary_cache

        if _refresh_active.is_set():
            return  # Un refresh è già in corso, non bloccare

        if not _refresh_lock.acquire(blocking=True, timeout=30):
            return
        try:
            _refresh_active.set()
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
            _refresh_active.clear()
            _refresh_lock.release()

    def _ensure_fresh(self, async_mode: bool = True) -> None:
        """Aggiorna la cache se stale. Con async_mode=True (default) non blocca mai."""
        now = time.time()
        has_cache = all(name in _node_data_cache for name in self.nodes)
        stale = any(
            name not in _node_data_cache or
            now - _node_data_cache[name].get("ts", 0) > CACHE_TTL
            for name in self.nodes
        )
        if stale or not has_cache:
            if _refresh_active.is_set():
                return  # Refresh già in corso, usa cache esistente
            if async_mode:
                # Trigger background refresh — API returns immediately with current cache
                _executor.submit(self._refresh_node_data)
            else:
                self._refresh_node_data()

    def _cache_is_fresh(self) -> bool:
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

    def get_cluster_health(self, node_filter: set = None) -> Dict:
        health = {
            "status": "healthy",
            "quorum": False,
            "nodes": [],
            "ha_status": {"enabled": False, "resources": []},
            "issues": [],
            "warnings": []
        }

        active_nodes = self.nodes
        if node_filter:
            active_nodes = {n: node for n, node in self.nodes.items() if n in node_filter}

        if not active_nodes:
            health["status"] = "no_nodes"
            health["issues"].append({"severity": "critical", "message": "Nessun nodo nel cluster"})
            return health

        online_count = 0
        total_count = len(active_nodes)

        for name, node_obj in active_nodes.items():
            d = _node_data_cache.get(name, {})
            cache_status = d.get("status")
            connected = node_obj.connected

            if connected and cache_status != "offline":
                is_online = True
            elif not d:
                is_online = connected
            else:
                is_online = cache_status == "online"

            node_info = {
                "name": name,
                "online": is_online,
                "ip": d.get("host", node_obj.host),
                "level": "",
                "local": False
            }
            health["nodes"].append(node_info)
            if is_online:
                online_count += 1

        has_quorum = online_count > (total_count / 2.0)
        health["quorum"] = has_quorum

        for node in health["nodes"]:
            if not node["online"]:
                health["issues"].append({
                    "severity": "critical",
                    "type": "node_offline",
                    "message": f"Nodo {node['name']} offline",
                    "node": node["name"]
                })

        try:
            first_online = next((n for n in active_nodes.values() if n.connected), None)
            if first_online:
                ha_status = first_online.get_cluster_ha_status()
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
            if node_filter and name not in node_filter:
                continue
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
        else:
            health["status"] = "healthy"

        return health

    def get_drs_recommendations(self, node_filter: set = None) -> Dict:
        recommendations = {
            "enabled": False,
            "recommendations": [],
            "nodes": [],
            "metrics": {}
        }

        eligible_nodes = self.nodes
        if node_filter:
            eligible_nodes = {n: node for n, node in self.nodes.items() if n in node_filter}

        if len(eligible_nodes) < 2:
            recommendations["message"] = "DRS richiede almeno 2 nodi"
            return recommendations

        recommendations["enabled"] = True

        for name, d in _node_data_cache.items():
            if node_filter and name not in node_filter:
                continue
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

    def get_vm_placement_suggestion(self, vm_vmid: int = None, vm_type: str = "qemu", node_filter: set = None) -> Dict:
        suggestions = {
            "current": None,
            "recommended": None,
            "nodes": []
        }

        node_scores = []

        for name, d in _node_data_cache.items():
            if node_filter and name not in node_filter:
                continue
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
    Chiamato dopo CRUD su proxmox_nodes e clusters.
    """
    global cluster
    from database import get_proxmox_nodes, get_proxmox_nodes_with_cluster, get_clusters
    from config import settings

    clusters_db = get_clusters()
    cluster._active_cluster = None
    if settings.PROXMOX_CLUSTERS:
        cluster._active_cluster = settings.PROXMOX_CLUSTERS[0]

    nodes_db = get_proxmox_nodes(enabled_only=True)
    all_nodes = get_proxmox_nodes_with_cluster()

    cluster_lookup = {}
    for c in clusters_db:
        cluster_lookup[c["id"]] = c

    node_cluster_map = {}
    for n in all_nodes:
        node_cluster_map[n["name"]] = cluster_lookup.get(n.get("cluster_id"))

    new_nodes = {}
    for nc in nodes_db:
        name = nc["name"]
        cluster_info = node_cluster_map.get(name)
        if name in cluster.nodes:
            old_node = cluster.nodes[name]
            old_node.host = nc["host"]
            old_node.port = nc["port"]
            old_node.timeout = nc["timeout"]
            old_node.cluster = cluster_info
            old_node.connected = False
            old_node._proxmox = None
            new_nodes[name] = old_node
        else:
            new_nodes[name] = ProxmoxNode(
                name=nc["name"],
                host=nc["host"],
                port=nc["port"],
                timeout=nc["timeout"],
                cluster=cluster_info,
            )

    for name in list(cluster.nodes.keys()):
        if name not in new_nodes:
            del cluster.nodes[name]

    cluster.nodes = new_nodes
    cluster.init_empty_cache()
    cluster.connect_all()
    # Il refresh avviene in background tramite metrics_collector


def init_cluster_from_db():
    """Inizializza il cluster leggendo i nodi dal database (senza connetterli)."""
    from database import get_proxmox_nodes, get_clusters, init_db
    from config import settings
    init_db()
    nodes_db = get_proxmox_nodes(enabled_only=True)
    clusters_db = get_clusters()

    cluster._active_cluster = None
    if settings.PROXMOX_CLUSTERS:
        cluster._active_cluster = settings.PROXMOX_CLUSTERS[0]

    cluster_lookup = {}
    for c in clusters_db:
        cluster_lookup[c["id"]] = c

    cluster.nodes = {}
    for nc in nodes_db:
        cluster_info = cluster_lookup.get(nc.get("cluster_id"))
        cluster.nodes[nc["name"]] = ProxmoxNode(
            name=nc["name"],
            host=nc["host"],
            port=nc["port"],
            timeout=nc["timeout"],
            cluster=cluster_info,
        )

    if cluster.nodes:
        cluster.init_empty_cache()
        print(f"Loaded {len(cluster.nodes)} nodes from database (connecting in background...)")
