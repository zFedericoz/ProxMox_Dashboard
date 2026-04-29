"""
AWS Secrets Manager integration for Proxmox Dashboard.
Loads all secrets from a single AWS Secret containing:
  - DB credentials (DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD)
  - Proxmox tokens (CLUSTER1_PROXMOX_TOKEN_NAME, CLUSTER1_PROXMOX_TOKEN_VALUE, CLUSTER2_*, ...)
  - JWT SECRET_KEY
"""
import os
import logging
from typing import Dict, Any, List

import boto3
from botocore.exceptions import ClientError, NoCredentialsError

logger = logging.getLogger(__name__)

SECRET_NAME = os.environ.get("AWS_SECRETS_SECRET_NAME", "syam-projectwork-pontos")
AWS_REGION = os.environ.get("AWS_REGION", "eu-west-1")


def get_secrets_manager_client():
    client_kwargs = {
        "region_name": os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION") or AWS_REGION,
    }

    access_key = os.environ.get("AWS_ACCESS_KEY_ID")
    secret_key = os.environ.get("AWS_SECRET_ACCESS_KEY")
    session_token = os.environ.get("AWS_SESSION_TOKEN")

    if access_key and secret_key:
        client_kwargs["aws_access_key_id"] = access_key
        client_kwargs["aws_secret_access_key"] = secret_key

    # Pass the session token only for temporary STS credentials.
    if session_token:
        client_kwargs["aws_session_token"] = session_token

    client = boto3.client("secretsmanager", **client_kwargs)
    return client


def get_secret(secret_name: str = None) -> Dict[str, Any]:
    """Fetch a single secret value from AWS Secrets Manager."""
    client = get_secrets_manager_client()
    try:
        response = client.get_secret_value(SecretId=secret_name or SECRET_NAME)
        if "SecretString" in response:
            import json
            return json.loads(response["SecretString"])
        else:
            raise ValueError("Binary secrets not supported")
    except ClientError as e:
        logger.error(f"AWS Secrets Manager error: {e}")
        raise
    except NoCredentialsError:
        logger.error("AWS credentials not found")
        raise


def load_all_secrets() -> Dict[str, Any]:
    """Load all secrets from the primary secret."""
    return get_secret(SECRET_NAME)


def get_cluster_proxmox_config(secrets: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Extract Proxmox cluster configs from secrets dict.
    Supports two formats:
    1. Single token (no prefix): PROXMOX_TOKEN_NAME, PROXMOX_TOKEN_VALUE -> CLUSTER1
    2. Multi-cluster: CLUSTER1_PROXMOX_TOKEN_NAME, CLUSTER1_PROXMOX_TOKEN_VALUE, etc.
    """
    clusters = []
    seen_prefixes = set()

    if "PROXMOX_TOKEN_NAME" in secrets and "PROXMOX_TOKEN_VALUE" in secrets:
        seen_prefixes.add("CLUSTER1")

    for key in secrets:
        if key.startswith("CLUSTER") and key.endswith("_PROXMOX_TOKEN_NAME"):
            prefix = key.replace("_PROXMOX_TOKEN_NAME", "")
            seen_prefixes.add(prefix)

    for prefix in sorted(seen_prefixes):
        if prefix == "CLUSTER1" and "PROXMOX_TOKEN_NAME" in secrets:
            token_name_key = "PROXMOX_TOKEN_NAME"
            token_value_key = "PROXMOX_TOKEN_VALUE"
        else:
            token_name_key = f"{prefix}_PROXMOX_TOKEN_NAME"
            token_value_key = f"{prefix}_PROXMOX_TOKEN_VALUE"

        if token_name_key in secrets and token_value_key in secrets:
            clusters.append({
                "name": prefix,
                "token_name": secrets[token_name_key],
                "token_value": secrets[token_value_key],
            })

    return clusters