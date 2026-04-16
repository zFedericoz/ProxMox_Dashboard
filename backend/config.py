"""
Configuration settings for the Proxmox Dashboard
"""
from pydantic_settings import BaseSettings
from typing import List
import os


class Settings(BaseSettings):
    # App
    APP_NAME: str = "Proxmox Cluster Dashboard"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    # Security
    SECRET_KEY: str = "proxmox-dashboard-secret-change-in-production-2024"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24  # 24h
    ALGORITHM: str = "HS256"

    # Database - PostgreSQL
    DATABASE_URL: str = "postgresql://<DB_USER>:<DB_PASSWORD>@syam-proxmox-dashboard-vmdtp.c9nj1x2p6gk5.eu-west-1.rds.amazonaws.com:5432/<DB_NAME>"
    DB_HOST: str = "syam-proxmox-dashboard-vmdtp.c9nj1x2p6gk5.eu-west-1.rds.amazonaws.com"
    DB_PORT: int = 5432
    DB_NAME: str = "postgres"
    DB_USER: str = ""
    DB_PASSWORD: str = ""

    # Proxmox Nodes - Auto-discovered from cluster via API
    PROXMOX_NODES: List[dict] = []
    PROXMOX_USER: str = "root@pam"
    PROXMOX_PASSWORD: str = ""
    PROXMOX_TOKEN_NAME: str = ""
    PROXMOX_TOKEN_VALUE: str = ""
    PROXMOX_VERIFY_SSL: bool = False

    # Polling intervals (seconds)
    METRICS_POLL_INTERVAL: int = 30
    LOGS_POLL_INTERVAL: int = 10
    SERVICES_POLL_INTERVAL: int = 60

    # ── Energia elettrica ────────────────────────────────────────────────────
    ELECTRICITY_COST_KWH: float = 0.28

    # TDP (Watt) per nodo: consumo idle e massimo
    NODE_TDP_IDLE_W: float = 20.0
    NODE_TDP_MAX_W: float = 65.0

    # Ore operative al mese (730 = 24/7)
    NODE_HOURS_PER_MONTH: float = 730.0

    # Overhead raffreddamento in %
    COOLING_OVERHEAD_PCT: float = 20.0

    # ── Costi fissi mensili ───────────────────────────────────────────────────
    MONTHLY_CONNECTIVITY: float = 50.0
    PROXMOX_SUBSCRIPTION_PER_NODE: float = 10.0
    MONTHLY_BACKUP_OFFSITE: float = 10.0

    # ── Ammortamento hardware ────────────────────────────────────────────────
    HARDWARE_COST_PER_NODE: float = 800.0
    HARDWARE_AMORTIZATION_MONTHS: float = 48.0

    # ── Budget totale mensile ────────────────────────────────────────────────
    MONTHLY_BUDGET: float = 500.0

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()