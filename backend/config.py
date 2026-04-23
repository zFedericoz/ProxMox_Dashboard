"""
Configuration settings for the Proxmox Dashboard.
All secrets loaded from AWS Secrets Manager.
"""
from pydantic_settings import BaseSettings
from typing import List, Dict, Any
import os

from aws_secrets import load_all_secrets, get_cluster_proxmox_config


class Settings(BaseSettings):
    APP_NAME: str = "Proxmox Cluster Dashboard"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    HOST: str = "0.0.0.0"
    PORT: int = 8000

    SECRET_KEY: str = ""
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24
    ALGORITHM: str = "HS256"

    DATABASE_URL: str = ""
    DB_HOST: str = ""
    DB_PORT: int = 5432
    DB_NAME: str = "postgres"
    DB_USER: str = ""
    DB_PASSWORD: str = ""
    DB_SSLMODE: str = "require"
    DB_SSLROOTCERT: str = ""

    PROXMOX_USER: str = "root@pam"
    PROXMOX_PASSWORD: str = ""
    PROXMOX_NODES: list = []
    PROXMOX_CLUSTERS: List[Dict[str, Any]] = []
    PROXMOX_VERIFY_SSL: bool = False

    METRICS_POLL_INTERVAL: int = 30
    LOGS_POLL_INTERVAL: int = 10
    SERVICES_POLL_INTERVAL: int = 60

    ELECTRICITY_COST_KWH: float = 0.28
    NODE_TDP_IDLE_W: float = 20.0
    NODE_TDP_MAX_W: float = 65.0
    NODE_HOURS_PER_MONTH: float = 730.0
    COOLING_OVERHEAD_PCT: float = 20.0
    MONTHLY_CONNECTIVITY: float = 50.0
    PROXMOX_SUBSCRIPTION_PER_NODE: float = 10.0
    MONTHLY_BACKUP_OFFSITE: float = 10.0
    HARDWARE_COST_PER_NODE: float = 800.0
    HARDWARE_AMORTIZATION_MONTHS: float = 48.0
    MONTHLY_BUDGET: float = 500.0

    class Config:
        extra = "allow"


def _load_settings_from_secrets() -> Settings:
    """Load settings from AWS Secrets Manager."""
    secrets = load_all_secrets()

    settings = Settings(
        DB_HOST=secrets.get("DB_HOST", ""),
        DB_PORT=int(secrets.get("DB_PORT", 5432)),
        DB_NAME=secrets.get("DB_NAME", "postgres"),
        DB_USER=secrets.get("DB_USER", ""),
        DB_PASSWORD=secrets.get("DB_PASSWORD", ""),
        SECRET_KEY=secrets.get("SECRET_KEY", ""),
        PROXMOX_USER=secrets.get("PROXMOX_USER", "root@pam"),
        PROXMOX_PASSWORD=secrets.get("PROXMOX_PASSWORD", ""),
        PROXMOX_CLUSTERS=get_cluster_proxmox_config(secrets),
    )

    for key in ["DB_SSLMODE", "DB_SSLROOTCERT", "DEBUG", "PORT",
                "METRICS_POLL_INTERVAL", "LOGS_POLL_INTERVAL", "SERVICES_POLL_INTERVAL",
                "ELECTRICITY_COST_KWH", "NODE_TDP_IDLE_W", "NODE_TDP_MAX_W",
                "NODE_HOURS_PER_MONTH", "COOLING_OVERHEAD_PCT",
                "MONTHLY_CONNECTIVITY", "PROXMOX_SUBSCRIPTION_PER_NODE",
                "MONTHLY_BACKUP_OFFSITE", "HARDWARE_COST_PER_NODE",
                "HARDWARE_AMORTIZATION_MONTHS", "MONTHLY_BUDGET"]:
        env_val = os.environ.get(key)
        if env_val is not None:
            if key in ["DB_PORT", "PORT", "METRICS_POLL_INTERVAL", "LOGS_POLL_INTERVAL",
                       "SERVICES_POLL_INTERVAL", "NODE_HOURS_PER_MONTH",
                       "HARDWARE_AMORTIZATION_MONTHS"]:
                setattr(settings, key, int(env_val))
            elif key in ["DEBUG"]:
                setattr(settings, key, env_val.lower() in ("true", "1", "yes"))
            elif key in ["ELECTRICITY_COST_KWH", "NODE_TDP_IDLE_W", "NODE_TDP_MAX_W",
                         "MONTHLY_CONNECTIVITY", "PROXMOX_SUBSCRIPTION_PER_NODE",
                         "MONTHLY_BACKUP_OFFSITE", "HARDWARE_COST_PER_NODE", "MONTHLY_BUDGET"]:
                setattr(settings, key, float(env_val))
            else:
                setattr(settings, key, env_val)

    settings.DATABASE_URL = (
        f"postgresql://{settings.DB_USER}:{settings.DB_PASSWORD}@"
        f"{settings.DB_HOST}:{settings.DB_PORT}/{settings.DB_NAME}"
    )

    return settings


settings = _load_settings_from_secrets()