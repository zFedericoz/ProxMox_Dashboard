# PWMO — Proxmox Web Management Orchestrator

Dashboard web per operatori MSP che devono monitorare e gestire in modo rapido cluster **Proxmox VE** (VM QEMU e container LXC), con integrazione cloud **AWS** e stack interamente **Docker**.

Il progetto risponde al tracciato *Project Work: Proxmox Web Management Orchestrator* (scenario **INFORMIX Spa**): portale leggero, **Cloud-Ready**, con credenziali esterne al codice, database gestito (RDS) e immagini versionate su registry privato (ECR).

## Architettura e scelte tecniche

| Componente | Scelta |
|------------|--------|
| **Backend** | **Python 3** + **FastAPI** (API REST, WebSocket per aggiornamenti in tempo reale) |
| **Client Proxmox** | **proxmoxer** (sessioni e chiamate API PVE) |
| **Frontend** | **React 18** + **Vite**, **Tailwind CSS**, **Recharts** (grafici), servizio statico tramite **Nginx** nel container |
| **Persistenza utenti e metriche** | **PostgreSQL** su **AWS RDS** (nessun database in container nello stack Compose di produzione) |
| **Segreti** | **AWS Secrets Manager**: all’avvio il backend legge un secret JSON (token Proxmox, stringa DB, chiave JWT). Nessun segreto sensibile hardcoded |
| **Immagini** | Predefinite per push/pull da **Amazon ECR** (`docker-compose.yml`: immagini taggate `.../syam-venturuzzo/backend` e `.../frontend`) |
| **Autenticazione dashboard** | Utenti nel database (password con hash **bcrypt**), sessioni **JWT** |

### Multi-cluster e nodi

È supportata la configurazione di **più cluster Proxmox** tramite token nominati (`CLUSTER1_*`, `CLUSTER2_*`, …) oppure un singolo token (`PROXMOX_TOKEN_NAME` / `PROXMOX_TOKEN_VALUE`). I nodi possono essere gestiti anche tramite persistenza in database (`init_cluster_from_db`).

## Requisiti di esecuzione

- Docker ≥ 20.10  
- Docker Compose ≥ 2.0  
- Account AWS con permessi a **Secrets Manager** (e per il build, **ECR** se si pubblicano le immagini)  
- Istanza **RDS PostgreSQL** raggiungibile dal backend

## Configurazione

### 1. Credenziali AWS per il runtime

Il backend deve poter chiamare Secrets Manager. In locale si usano di solito variabili d’ambiente (vedi `.env.example`).

Copia `.env.example` in `.env` e inserisci le **tue** chiavi AWS (access key / secret; eventuale session token se usi credenziali temporanee).

### 2. Secret in AWS Secrets Manager

Nome secret configurabile con `AWS_SECRETS_SECRET_NAME` (default di progetto: `syam-projectwork-pontos`).

Il secret deve essere una stringa JSON con almeno:

#### Database PostgreSQL (RDS)

| Chiave | Descrizione |
|--------|-------------|
| `DB_HOST` | Endpoint RDS |
| `DB_PORT` | Porta (es. `5432`) |
| `DB_NAME` | Nome database |
| `DB_USER` | Utente |
| `DB_PASSWORD` | Password |

#### Token API Proxmox (solo token PVE, no password root in chiaro sul tracciato)

Per ogni cluster:

| Chiave | Descrizione |
|--------|-------------|
| `CLUSTER1_PROXMOX_TOKEN_NAME` | Nome token (es. `automation@pam!dashboard-token`) |
| `CLUSTER1_PROXMOX_TOKEN_VALUE` | Valore del token |
| `CLUSTER2_PROXMOX_TOKEN_NAME` | … |
| `CLUSTER2_PROXMOX_TOKEN_VALUE` | … |

È supportato anche il formato con chiavi `PROXMOX_TOKEN_NAME` e `PROXMOX_TOKEN_VALUE` (cluster singolo).

#### Sicurezza JWT

| Chiave | Descrizione |
|--------|-------------|
| `SECRET_KEY` | Chiave per la firma dei token JWT |

#### Esempio (valori segnaposto)

```json
{
  "DB_HOST": "your-cluster.region.rds.amazonaws.com",
  "DB_PORT": "5432",
  "DB_NAME": "postgres",
  "DB_USER": "app_user",
  "DB_PASSWORD": "your-secure-password",
  "SECRET_KEY": "your-jwt-signing-secret",
  "CLUSTER1_PROXMOX_TOKEN_NAME": "automation@pam!dashboard-token",
  "CLUSTER1_PROXMOX_TOKEN_VALUE": "your-token-uuid",
  "CLUSTER2_PROXMOX_TOKEN_NAME": "automation@pam!other-token",
  "CLUSTER2_PROXMOX_TOKEN_VALUE": "your-second-token-uuid"
}
```

Opzionalmente il secret o l’ambiente possono includere altri campi documentati in `config.py` (es. costi, intervalli di polling metriche).

## Avvio con Docker Compose

```bash
docker compose up -d
```

Dopo l’avvio, l’interfaccia è pubblicata sulla porta **8000** del host (mapping `8000:80` sul frontend).  
API e documentazione OpenAPI: `http://localhost:8000/api/docs` (il backend espone le API sullo stesso host tramite proxy/nginx nel flusso previsto dall’immagine frontend).

### Variabili d’ambiente principali (Compose)

| Variabile | Descrizione | Default tipico |
|-----------|-------------|----------------|
| `AWS_ACCESS_KEY_ID` | Access key | obbligatorio in locale se non si usa IAM role |
| `AWS_SECRET_ACCESS_KEY` | Secret key | obbligatorio |
| `AWS_SESSION_TOKEN` | Token sessione (credenziali temporanee) | vuoto |
| `AWS_REGION` | Regione AWS | `eu-west-1` |
| `AWS_SECRETS_SECRET_NAME` | Nome del secret in Secrets Manager | `syam-projectwork-pontos` |
| `BACKEND_IMAGE` / `FRONTEND_IMAGE` | Override immagini ECR | vedi `docker-compose.yml` |

### Comandi utili

```bash
# Log in tempo reale
docker compose logs -f

# Arresto
docker compose down

# Riavvio
docker compose restart

# Ricostruzione completa
docker compose down && docker compose build --no-cache && docker compose up -d
```

## Funzionalità rispetto al tracciato

**Livello 1 (core):**

- Dashboard di stato (CPU, RAM, storage a livello nodo) e metriche nel tempo (storico su DB, es. ultimi minuti/ore in base alla configurazione).  
- Inventario VM e container con identificativi e nomi.  
- Azioni di power (start, stop, shutdown, reboot) sulle risorse.  
- Snapshot e integrazione **backup** (storaggi backup Proxmox / PBS dove configurato), con **storico** e messaggi di **avviso** se uno storage o il nodo non sono raggiungibili (l’applicazione non deve bloccarsi in modo irreversibile: vengono restituiti elenchi vuoti o warning espliciti).  
- **Cloud**: RDS esterno, Secrets Manager all’avvio, pipeline immagini verso **ECR**.

**Opzionali (bonus):**

- Consapevolezza **multi-nodo / cluster** (più nodi e più cluster).  
- **Migrazione** VM e container tra nodi (endpoint dedicati nell’API).

## Utente predefinito (sviluppo / prima installazione)

- **Utente:** `admin`  
- **Password:** `admin`  

In produzione va cambiata e protegendo l’accesso (HTTPS, reti, IAM role al posto delle chiavi statiche ove possibile).

## Struttura del repository

```
ProxMox_Dashboard/
├── backend/
│   ├── Dockerfile
│   ├── main.py              # FastAPI, API Proxmox, auth, WebSocket
│   ├── config.py            # Settings da Secrets Manager + env
│   ├── aws_secrets.py       # Integrazione AWS Secrets Manager
│   ├── database.py        # PostgreSQL (RDS)
│   ├── proxmox_client.py    # proxmoxer, cache, metriche
│   └── api/                 # Router (nodi, alert, cluster)
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── src/                 # React (pagine Overview, Nodi, Backup, …)
├── docker-compose.yml
├── .env.example
└── README.md
```

## Consegna e materiali (come da specifica)

Oltre al codice e al Compose, il progetto prevede anche **piano di test** delle API e **presentazione** (demo prodotto + relazione tecnica): preparare questi materiali separatamente per la revisione.

## Produzione: suggerimenti

- Preferire **IAM role** (ECS, EC2, ecc.) al posto di access key su file o env dove possibile.  
- **HTTPS** e reverse proxy (Traefik, Caddy, ALB).  
- Rete e **security group** per RDS e per l’accesso API ai nodi Proxmox.  
- Rotazione periodica dei secret in Secrets Manager e dei token Proxmox.
