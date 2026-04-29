# Usare il branche nuovo...
# Proxmox Cluster Dashboard

Dashboard di monitoraggio per cluster Proxmox con 3 nodi.

## Requisiti

- Docker >= 20.10
- Docker Compose >= 2.0
- AWS Secrets Manager (per le credenziali)

## Configurazione

Tutte le credenziali sono centralizzate in AWS Secrets Manager (secret: `syam-projectwork-pontos`).

Il secret deve contenere:

### Database PostgreSQL (RDS)
| Chiave | Descrizione |
|--------|-------------|
| `DB_HOST` | Endpoint AWS RDS PostgreSQL |
| `DB_PORT` | Porta database (default: 5432) |
| `DB_NAME` | Nome database PostgreSQL |
| `DB_USER` | Utente database PostgreSQL |
| `DB_PASSWORD` | Password database PostgreSQL |

### Proxmox API Token (multi-cluster)
Per ogni cluster, aggiungi le chiavi:

| Chiave | Descrizione |
|--------|-------------|
| `CLUSTER1_PROXMOX_TOKEN_NAME` | Nome token (es. `automation@pam!dashboard-token`) |
| `CLUSTER1_PROXMOX_TOKEN_VALUE` | Valore del token |
| `CLUSTER2_PROXMOX_TOKEN_NAME` | Nome token cluster 2 |
| `CLUSTER2_PROXMOX_TOKEN_VALUE` | Valore token cluster 2 |

### JWT Security
| Chiave | Descrizione |
|--------|-------------|
| `SECRET_KEY` | Chiave segreta per JWT |

### Esempio JSON Secret
```json
{
  "DB_HOST": "syam-projectwork-pontos.c9nj1x2p6gk5.eu-west-1.rds.amazonaws.com",
  "DB_PORT": "5432",
  "DB_NAME": "postgres",
  "DB_USER": "pontos",
  "DB_PASSWORD": "your-db-password",
  "SECRET_KEY": "your-jwt-secret-key",
  "CLUSTER1_PROXMOX_TOKEN_NAME": "automation@pam!dashboard-token",
  "CLUSTER1_PROXMOX_TOKEN_VALUE": "your-cluster1-token-value",
  "CLUSTER2_PROXMOX_TOKEN_NAME": "automation@pam!prod-token",
  "CLUSTER2_PROXMOX_TOKEN_VALUE": "your-cluster2-token-value"
}
```

## Avvio

```bash
# Avvio (AWS credentials devono essere disponibili come env vars)
docker-compose up -d
```

### Variabili ambiente (Docker Compose)

| Variabile | Descrizione | Default |
|-----------|-------------|---------|
| `AWS_ACCESS_KEY_ID` | AWS Access Key | (required) |
| `AWS_SECRET_ACCESS_KEY` | AWS Secret Key | (required) |
| `AWS_SESSION_TOKEN` | AWS Session Token (se IAM temporaneo) | vuoto |
| `AWS_REGION` | AWS Region | `eu-west-1` |
| `AWS_SECRETS_SECRET_NAME` | Nome secret in Secrets Manager | `syam-projectwork-pontos` |

## Comandi Utili

```bash
# Log in tempo reale
docker-compose logs -f

# Fermare i container
docker-compose down

# Riavviare
docker-compose restart

# Rebuild completo
docker-compose down && docker-compose build --no-cache && docker-compose up -d
```

## Credenziali Default

- **Username:** admin
- **Password:** admin123

## Struttura

```
proxmox-dashboard/
├── backend/
│   ├── Dockerfile
│   ├── main.py
│   ├── config.py
│   ├── database.py
│   ├── secrets.py          # AWS Secrets Manager integration
│   └── proxmox_client.py
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── src/
├── docker-compose.yml
└── .dockerignore
```

## Produzione

Per produzione, considera:
- Usare IAM Role invece di Access Keys
- Usare un reverse proxy (Traefik, Caddy)
- Abilitare HTTPS
- Configurare VPC e security groups per RDS
- Usare AWS Secrets Manager per tutte le credenziali
