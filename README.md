# Usare il branche nuovo...
# Proxmox Cluster Dashboard

Dashboard di monitoraggio per cluster Proxmox con 3 nodi.

## Requisiti

- Docker >= 20.10
- Docker Compose >= 2.0
- AWS Secrets Manager (per le credenziali)

## Configurazione

Tutte le credenziali sensibili sono in **AWS Secrets Manager** (default secret name: `syam-projectwork-pontos`, override con `AWS_SECRETS_SECRET_NAME`).

**Non serve un file `.env` in AWS:** il backend usa il **ruolo IAM** del calcolo (EC2, ECS task, Lambda, EKS IRSA, ecc.). boto3 risolve le credenziali automaticamente senza chiavi statiche nel container.

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

### AWS: IAM e Secrets Manager (Secret Orchestration)

1. **Crea il secret** in Secrets Manager (tipo “Altri”) con il JSON documentato sopra. Annota **nome** o **ARN**.

2. **Crea un ruolo IAM** per il tuo workload e **non** distribuire access key nei container.

   Policy minima sul ruolo (sostituisci `REGION`, `ACCOUNT_ID`, `SECRET_NAME_WILDCARD`):

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "ReadDashboardSecret",
         "Effect": "Allow",
         "Action": [
           "secretsmanager:GetSecretValue",
           "secretsmanager:DescribeSecret"
         ],
         "Resource": "arn:aws:secretsmanager:REGION:ACCOUNT_ID:secret:SECRET_NAME_WILDCARD"
       }
     ]
   }
   ```

   Tipico suffisso ARN: il nome secret ha un suffisso casuale (`-AbCdEf`). In console, usa **Copia ARN** e nel JSON usa `arn:...:secret:name-*` oppure l’ARN completo.

   Se il secret usa una **KMS key dedicata**, aggiungi su quel ruolo anche `kms:Decrypt` sulla key CMK usata dal secret.

3. **Associa il ruolo al calcolo**
   - **EC2:** Instance profile → collega il ruolo all’istanza.
   - **ECS (Fargate/EC2):** Task role nel task definition (non execution role per Secrets Manager API dell’app — l’execution role serve solo a pull immagine/log).
   - **EKS:** IRSA (OIDC) → `serviceAccount` con annotation `eks.amazonaws.com/role-arn`.
   - **Lambda:** Execution role con la stessa policy.

4. **Variabili ambiente** (solo non-segreti, impostate dal task/systemd/K8s):

   | Variabile | Descrizione | Default |
   |-----------|-------------|---------|
   | `AWS_REGION` | Regione Secrets Manager | `eu-west-1` |
   | `AWS_SECRETS_SECRET_NAME` | Nome o ARN del secret | `syam-projectwork-pontos` |
   | `CORS_ORIGINS` | Origini CORS separate da virgola | localhost predefiniti |

   Chiavi `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` sono **opzionali** e consigliate solo in sviluppo locale senza ruolo IAM.

## Avvio

```bash
# Con ruolo IAM sul host (es. EC2) o credenziali SSO / profilo AWS nel contesto shell
docker-compose up -d
```

### Variabili ambiente (Docker Compose)

| Variabile | Descrizione | Default |
|-----------|-------------|---------|
| `AWS_REGION` | AWS Region | `eu-west-1` |
| `AWS_SECRETS_SECRET_NAME` | Nome secret in Secrets Manager | `syam-projectwork-pontos` |
| `AWS_ACCESS_KEY_ID` | Opzionale (solo dev locale senza ruolo) | — |
| `AWS_SECRET_ACCESS_KEY` | Opzionale (solo dev locale senza ruolo) | — |
| `AWS_SESSION_TOKEN` | Opzionale (sessione temporanea) | — |
| `AWS_PROFILE` | Opzionale (con `~/.aws` montato nel container) | — |

**Sviluppo locale (Docker su laptop):** senza instance metadata, monta le credenziali AWS CLI, ad esempio aggiungendo al servizio `backend` un volume `~/.aws:/root/.aws:ro` ed esportando `AWS_PROFILE`. In alternativa export temporaneo delle variabili dopo `aws sso login`.

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
- **Password:** admin

## Struttura

```
proxmox-dashboard/
├── backend/
│   ├── Dockerfile
│   ├── main.py
│   ├── config.py
│   ├── database.py
│   ├── aws_secrets.py      # AWS Secrets Manager integration
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
- **Ruolo IAM** per Secrets Manager (evita access key nei container)
- Un reverse proxy (Traefik, Caddy)
- HTTPS
- VPC e security groups per RDS
