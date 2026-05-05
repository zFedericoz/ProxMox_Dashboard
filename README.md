# PWMO — Proxmox Web Management Orchestrator

Dashboard web per operatori MSP che devono monitorare e gestire in modo rapido cluster **Proxmox VE** (VM QEMU e container LXC), con integrazione cloud **AWS** e stack interamente **Docker**.

## Architettura e scelte tecniche

| Componente | Scelta |
|------------|--------|
| **Backend** | **Python 3** + **FastAPI** (API REST, WebSocket per aggiornamenti in tempo reale) |
| **Client Proxmox** | **proxmoxer** (sessioni e chiamate API PVE) |
| **Frontend** | **React 18** + **Vite**, **Tailwind CSS**, **Recharts** (grafici), servizio statico tramite **Nginx** nel container |
| **Persistenza utenti e metriche** | **PostgreSQL** su **AWS RDS** (nessun database in container nello stack Compose di produzione) |
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

Opzionalmente il secret o l’ambiente possono includere altri campi documentati in `config.py` (es. costi, intervalli di polling metriche).

## Avvio con Docker Compose

```bash
docker compose up -d
```

Dopo l’avvio, l’interfaccia è pubblicata sulla porta **8000** del host (mapping `8000:80` sul frontend).  
API e documentazione OpenAPI: `http://localhost:8000/api/docs` (il backend espone le API sullo stesso host tramite proxy/nginx nel flusso previsto dall’immagine frontend).

## Funzionalità

- Dashboard di stato (CPU, RAM, storage a livello nodo) e metriche nel tempo (storico su DB, es. ultimi minuti/ore in base alla configurazione).  
- Inventario VM e container con identificativi e nomi.  
- Azioni di power (start, stop, shutdown, reboot) sulle risorse.  
- Snapshot e integrazione **backup** (storaggi backup Proxmox / PBS dove configurato), con **storico** e messaggi di **avviso** se uno storage o il nodo non sono raggiungibili (l’applicazione non deve bloccarsi in modo irreversibile: vengono restituiti elenchi vuoti o warning espliciti).  
- **Cloud**: RDS esterno, Secrets Manager all’avvio, pipeline immagini verso **ECR**.

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
