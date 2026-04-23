"""
Database - PostgreSQL for Proxmox Dashboard.
"""
import queue
import threading
import time
from datetime import datetime
from contextlib import contextmanager
from typing import Optional, List, Dict

import psycopg2
from psycopg2 import pool
from psycopg2.extras import RealDictCursor

from config import settings

_connection_pool = None

def init_pool():
    """Initialize connection pool."""
    global _connection_pool
    if _connection_pool is None:
        if not settings.DB_HOST or not settings.DB_HOST.strip():
            raise RuntimeError("DB_HOST is empty. Configure AWS Secrets Manager secret 'syam-projectwork-pontos'.")
        if not settings.DB_USER or not settings.DB_USER.strip():
            raise RuntimeError("DB_USER is empty. Configure AWS Secrets Manager secret 'syam-projectwork-pontos'.")
        if not settings.DB_PASSWORD or not settings.DB_PASSWORD.strip():
            raise RuntimeError("DB_PASSWORD is empty. Configure AWS Secrets Manager secret 'syam-projectwork-pontos'.")

        connect_kwargs = {
            "host": settings.DB_HOST,
            "port": settings.DB_PORT,
            "database": settings.DB_NAME,
            "user": settings.DB_USER,
            "password": settings.DB_PASSWORD,
            "sslmode": settings.DB_SSLMODE
        }
        if settings.DB_SSLROOTCERT:
            connect_kwargs["sslrootcert"] = settings.DB_SSLROOTCERT

        _connection_pool = pool.ThreadedConnectionPool(
            minconn=2,
            maxconn=50,
            **connect_kwargs
        )
    return _connection_pool

def get_db():
    """
    Get database connection from pool.
    Returns a wrapper that mimics sqlite3.Connection interface.
    """
    pool = init_pool()
    conn = pool.getconn()
    conn.autocommit = False
    return _PostgresConnection(conn, pool)

class _PostgresConnection:
    """Wrapper to mimic sqlite3.Connection interface."""
    def __init__(self, conn, pool):
        self._conn = conn
        self._pool = pool
        self._cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    def execute(self, query, params=None):
        """Execute a query."""
        if params:
            self._cursor.execute(query, params)
        else:
            self._cursor.execute(query)
        return self
    
    def fetchone(self):
        return self._cursor.fetchone()
    
    def fetchall(self):
        return self._cursor.fetchall()
    
    def commit(self):
        self._conn.commit()
    
    def rollback(self):
        self._conn.rollback()
    
    def close(self):
        self._cursor.close()
        self._pool.putconn(self._conn)
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            self._conn.rollback()
        else:
            self._conn.commit()
        self.close()
        return False


# ── Async log queue ───────────────────────────────────────────────────────────
_log_queue = queue.Queue(maxsize=5000)

def _log_worker():
    """Thread daemon che drena la coda e scrive i log in batch."""
    BATCH_SIZE = 50
    BATCH_WAIT = 1.0
    
    while True:
        batch = []
        try:
            while len(batch) < BATCH_SIZE:
                try:
                    item = _log_queue.get(timeout=BATCH_WAIT)
                    batch.append(item)
                except queue.Empty:
                    break
        except Exception:
            time.sleep(1)
            continue
        
        if not batch:
            continue
        
        try:
            pool = init_pool()
            conn = pool.getconn()
            conn.autocommit = True
            cursor = conn.cursor()
            
            # Batch activity logs
            activity_batch = [item[1] for item in batch if item[0] == _write_activity]
            if activity_batch:
                cursor.executemany("""
                    INSERT INTO activity_log (timestamp, "user", action, resource, node, status, ip_address, details, severity)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, activity_batch)
            
            # Batch access logs
            access_batch = [item[1] for item in batch if item[0] == _write_access]
            if access_batch:
                cursor.executemany("""
                    INSERT INTO access_log (timestamp, username, action, endpoint, method, ip_address, user_agent, status_code, response_time_ms)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, access_batch)
            
            cursor.close()
            pool.putconn(conn)
        except Exception:
            pass

_log_thread = threading.Thread(target=_log_worker, daemon=True)
_log_thread.start()


def _write_activity(data):
    return data

def _write_access(data):
    return data


def log_activity(user: str, action: str, resource: str = None,
                 node: str = None, status: str = "success",
                 ip_address: str = None, details: str = None,
                 severity: str = "info"):
    """Fire-and-forget: mette il log in coda senza bloccare il chiamante."""
    try:
        _log_queue.put_nowait((
            _write_activity,
            (datetime.now().isoformat(), user, action, resource, node,
             status, ip_address, details, severity)
        ))
    except queue.Full:
        pass


log_activity_async = log_activity


def log_access(username: str, action: str, endpoint: str,
               method: str, ip_address: str, user_agent: str,
               status_code: int, response_time_ms: float):
    """Fire-and-forget: access log non blocca mai le richieste HTTP."""
    if endpoint in ("/api/health", "/") or endpoint.startswith("/static"):
        return
    
    try:
        _log_queue.put_nowait((
            _write_access,
            (datetime.now().isoformat(), username, action, endpoint, method,
             ip_address, user_agent[:200], status_code, round(response_time_ms, 2))
        ))
    except queue.Full:
        pass


# ── Database Init ─────────────────────────────────────────────────────────────
def init_db():
    """Initialize database tables."""
    conn = get_db()
    cursor = conn._cursor
    
    # Users table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(100) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            email VARCHAR(255),
            role VARCHAR(20) DEFAULT 'viewer',
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMP
        )
    """)
    
    # Activity log
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS activity_log (
            id SERIAL PRIMARY KEY,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            "user" VARCHAR(100),
            action TEXT,
            resource VARCHAR(255),
            node VARCHAR(100),
            status VARCHAR(20),
            ip_address VARCHAR(45),
            details TEXT,
            severity VARCHAR(20) DEFAULT 'info'
        )
    """)
    
    # Access log
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS access_log (
            id SERIAL PRIMARY KEY,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            username VARCHAR(100),
            action TEXT,
            endpoint VARCHAR(500),
            method VARCHAR(10),
            ip_address VARCHAR(45),
            user_agent VARCHAR(200),
            status_code INTEGER,
            response_time_ms REAL
        )
    """)
    
    # Proxmox nodes
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS proxmox_nodes (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) UNIQUE NOT NULL,
            host VARCHAR(255) NOT NULL,
            port INTEGER DEFAULT 8006,
            timeout INTEGER DEFAULT 8,
            zone VARCHAR(100) DEFAULT 'Default',
            enabled BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Metrics snapshots
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS metrics_snapshots (
            id SERIAL PRIMARY KEY,
            node_name VARCHAR(100),
            node_ip VARCHAR(255),
            cpu_usage REAL,
            mem_used BIGINT,
            mem_total BIGINT,
            disk_used BIGINT,
            disk_total BIGINT,
            uptime BIGINT,
            load_avg TEXT,
            vm_count INTEGER,
            ct_count INTEGER,
            status VARCHAR(20),
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Cost config
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS cost_config (
            id SERIAL PRIMARY KEY,
            key VARCHAR(100) UNIQUE NOT NULL,
            value REAL,
            description TEXT,
            unit VARCHAR(20),
            category VARCHAR(50)
        )
    """)
    
    # Cost config nodes
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS cost_config_nodes (
            id SERIAL PRIMARY KEY,
            node_name VARCHAR(100) UNIQUE NOT NULL,
            tdp_idle_w REAL DEFAULT 20.0,
            tdp_max_w REAL DEFAULT 65.0,
            hours_per_month REAL DEFAULT 730.0,
            hardware_cost REAL DEFAULT 800.0,
            amortization_months REAL DEFAULT 48.0,
            enabled BOOLEAN DEFAULT TRUE,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # Alerts
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS alerts (
            id SERIAL PRIMARY KEY,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            severity VARCHAR(20),
            message TEXT,
            node VARCHAR(100),
            resource VARCHAR(255),
            resolved BOOLEAN DEFAULT FALSE,
            resolved_at TIMESTAMP
        )
    """)
    
    # Create indexes
    indexes = [
        "CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(\"user\")",
        "CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_log(timestamp DESC)",
        "CREATE INDEX IF NOT EXISTS idx_access_timestamp ON access_log(timestamp DESC)",
        "CREATE INDEX IF NOT EXISTS idx_access_username ON access_log(username)",
        "CREATE INDEX IF NOT EXISTS idx_metrics_node_timestamp ON metrics_snapshots(node_name, timestamp DESC)",
        "CREATE INDEX IF NOT EXISTS idx_alerts_node ON alerts(node)",
        "CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON alerts(resolved)",
    ]
    
    for idx in indexes:
        cursor.execute(idx)
    
    conn.commit()
    conn.close()
    
    print(f"✅ Database initialized (PostgreSQL)")


# ── CRUD Functions ───────────────────────────────────────────────────────────
def get_proxmox_nodes(enabled_only: bool = False) -> List[Dict]:
    conn = get_db()
    try:
        if enabled_only:
            conn.execute("SELECT * FROM proxmox_nodes WHERE enabled = TRUE ORDER BY name")
        else:
            conn.execute("SELECT * FROM proxmox_nodes ORDER BY name")
        rows = conn.fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception as e:
        conn.close()
        return []

def get_proxmox_node(name: str) -> Optional[Dict]:
    conn = get_db()
    try:
        conn.execute("SELECT * FROM proxmox_nodes WHERE name = %s", (name,))
        row = conn.fetchone()
        conn.close()
        return dict(row) if row else None
    except Exception:
        conn.close()
        return None

def create_proxmox_node(name: str, host: str, port: int = 8006, timeout: int = 8, zone: str = "Default") -> bool:
    conn = get_db()
    try:
        conn.execute("""
            INSERT INTO proxmox_nodes (name, host, port, timeout, zone)
            VALUES (%s, %s, %s, %s, %s)
        """, (name, host, port, timeout, zone))
        conn.commit()
        conn.close()
        return True
    except Exception:
        conn.close()
        return False

def update_proxmox_node(name: str, **kwargs) -> Optional[Dict]:
    allowed = {"host", "port", "timeout", "zone", "enabled"}
    kwargs = {k: v for k, v in kwargs.items() if k in allowed}
    if not kwargs:
        return None
    
    set_clause = ", ".join([f"{k} = %s" for k in kwargs.keys()])
    values = list(kwargs.values()) + [name]
    
    conn = get_db()
    try:
        conn.execute(
            f"UPDATE proxmox_nodes "
            f"SET {set_clause}, updated_at = CURRENT_TIMESTAMP "
            f"WHERE name = %s "
            f"RETURNING *",
            values,
        )
        row = conn.fetchone()
        conn.commit()
        conn.close()
        return dict(row) if row else None
    except Exception:
        conn.close()
        return None

def delete_proxmox_node(name: str) -> bool:
    conn = get_db()
    try:
        conn.execute("DELETE FROM proxmox_nodes WHERE name = %s", (name,))
        conn.commit()
        conn.close()
        return True
    except Exception:
        conn.close()
        return False


def get_cost_config() -> List[Dict]:
    conn = get_db()
    try:
        conn.execute("SELECT key, value FROM cost_config")
        rows = conn.fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception:
        conn.close()
        return []

def get_cost_config_nodes() -> List[Dict]:
    conn = get_db()
    try:
        conn.execute("SELECT * FROM cost_config_nodes")
        rows = conn.fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception:
        conn.close()
        return []

def upsert_cost_config(key: str, value: float, description: str = "", unit: str = "", category: str = "general") -> bool:
    conn = get_db()
    try:
        conn.execute("""
            INSERT INTO cost_config (key, value, description, unit, category)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description
        """, (key, value, description, unit, category))
        conn.commit()
        conn.close()
        return True
    except Exception:
        conn.close()
        return False

def upsert_node_config(node_name: str, **kwargs) -> bool:
    allowed = {"tdp_idle_w", "tdp_max_w", "hours_per_month", "hardware_cost", "amortization_months", "enabled"}
    kwargs = {k: v for k, v in kwargs.items() if k in allowed}
    if not kwargs:
        return False
    
    conn = get_db()
    try:
        conn.execute(f"""
            INSERT INTO cost_config_nodes (node_name, tdp_idle_w, tdp_max_w, hours_per_month, hardware_cost, amortization_months, enabled)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (node_name) DO UPDATE SET 
                tdp_idle_w = COALESCE(EXCLUDED.tdp_idle_w, cost_config_nodes.tdp_idle_w),
                tdp_max_w = COALESCE(EXCLUDED.tdp_max_w, cost_config_nodes.tdp_max_w),
                updated_at = CURRENT_TIMESTAMP
        """, [node_name, 20.0, 65.0, 730.0, 800.0, 48.0, True])
        conn.commit()
        conn.close()
        return True
    except Exception:
        conn.close()
        return False


def get_activity_logs(limit: int = 50) -> List[Dict]:
    conn = get_db()
    try:
        conn.execute("SELECT * FROM activity_log ORDER BY timestamp DESC LIMIT %s", (limit,))
        rows = conn.fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception:
        conn.close()
        return []

def get_access_logs(limit: int = 100) -> List[Dict]:
    conn = get_db()
    try:
        conn.execute("SELECT * FROM access_log ORDER BY timestamp DESC LIMIT %s", (limit,))
        rows = conn.fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception:
        conn.close()
        return []


def get_recent_tasks(since: int = 3600) -> List[Dict]:
    """Get recent Proxmox tasks."""
    conn = get_db()
    try:
        conn.execute("SELECT * FROM activity_log WHERE action LIKE 'task:%' AND timestamp > NOW() - INTERVAL '1 hour' ORDER BY timestamp DESC")
        rows = conn.fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception:
        conn.close()
        return []

def get_alerts(severity: str = None, limit: int = 100, unresolved: bool = False) -> List[Dict]:
    conn = get_db()
    try:
        if unresolved:
            conn.execute("SELECT * FROM alerts WHERE resolved = FALSE ORDER BY timestamp DESC LIMIT %s", (limit,))
        elif severity:
            conn.execute("SELECT * FROM alerts WHERE severity = %s ORDER BY timestamp DESC LIMIT %s", (severity, limit))
        else:
            conn.execute("SELECT * FROM alerts ORDER BY timestamp DESC LIMIT %s", (limit,))
        rows = conn.fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception:
        conn.close()
        return []


def get_user_activity(username: str, limit: int = 50) -> List[Dict]:
    conn = get_db()
    try:
        conn.execute('SELECT * FROM activity_log WHERE "user" = %s ORDER BY timestamp DESC LIMIT %s', (username, limit))
        rows = conn.fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception:
        conn.close()
        return []

def get_user_access(username: str, limit: int = 50) -> List[Dict]:
    conn = get_db()
    try:
        conn.execute("SELECT * FROM access_log WHERE username = %s ORDER BY timestamp DESC LIMIT %s", (username, limit))
        rows = conn.fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception:
        conn.close()
        return []


def save_metric_snapshot(node_name: str, **metrics):
    """Save metrics snapshot."""
    conn = get_db()
    try:
        conn.execute("""
            INSERT INTO metrics_snapshots 
            (node_name, node_ip, cpu_usage, mem_used, mem_total, disk_used, disk_total, uptime, load_avg, vm_count, ct_count, status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            node_name, metrics.get("host", ""),
            metrics.get("cpu_usage", 0),
            metrics.get("mem_used", 0),
            metrics.get("mem_total", 0),
            metrics.get("disk_used", 0),
            metrics.get("disk_total", 0),
            metrics.get("uptime", 0),
            metrics.get("load_avg", "[]"),
            metrics.get("vm_count", 0),
            metrics.get("ct_count", 0),
            metrics.get("status", "online")
        ))
        conn.commit()
        conn.close()
    except Exception:
        conn.close()


def cleanup_old_metrics(days: int = 30):
    """Delete old metrics."""
    conn = get_db()
    try:
        conn.execute("DELETE FROM metrics_snapshots WHERE timestamp < NOW() - INTERVAL '1 day' * %s", (days,))
        conn.commit()
        conn.close()
    except Exception:
        conn.close()
    return True