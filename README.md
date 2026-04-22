# Proxmox Cluster Dashboard

Dashboard di monitoraggio per cluster Proxmox con 3 nodi.

## Requisiti

- Docker >= 20.10
- Docker Compose >= 2.0
- PostgreSQL su AWS RDS raggiungibile (no DB locale)

## Configurazione

1. Copia `.env.example` in `.env` e modifica le credenziali (oppure aggiorna `docker-compose.yml` se preferisci tenere tutto lì):

```bash
cp .env.example .env
nano .env
```

2. Modifica almeno queste variabili:
   - `DB_USER` - utente PostgreSQL RDS
   - `DB_PASSWORD` - password PostgreSQL RDS
   - `DB_NAME` - database PostgreSQL RDS
   - `PROXMOX_PASSWORD` - Password del tuo server Proxmox
   - `SECRET_KEY` - Chiave segreta per JWT (cambiala in produzione!)

## Avvio

```bash
# Avvio
docker-compose up -d
```

La dashboard sarà disponibile su: **http://localhost:8000**

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
│   └── proxmox_client.py
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── src/
├── docker-compose.yml
├── .env.example
└── .dockerignore
```

## Variabili Environment

| Variabile | Descrizione | Default |
|-----------|-------------|---------|
| `PORT` | Porta del server | 8000 |
| `DB_HOST` | Endpoint AWS RDS PostgreSQL | `syam-progetto-aws-tpmdv.c9nj1x2p6gk5.eu-west-1.rds.amazonaws.com` |
| `DB_PORT` | Porta database | `5432` |
| `DB_NAME` | Nome database PostgreSQL | `postgres` |
| `DB_USER` | Utente database PostgreSQL | `(required)` |
| `DB_PASSWORD` | Password database PostgreSQL | `(required)` |
| `DB_SSLMODE` | SSL mode connessione | `require` |
| `DB_SSLROOTCERT` | CA bundle path (opzionale) | vuoto |
| `PROXMOX_NODES` | Nodi Proxmox (JSON) | 3 nodi default |
| `PROXMOX_USER` | Utente Proxmox | root@pam |
| `PROXMOX_PASSWORD` | Password Proxmox | (richiesto) |
| `SECRET_KEY` | Chiave JWT | (generato) |
| `PROXMOX_VERIFY_SSL` | Verifica SSL | false |

## Produzione

Per produzione, considera:
- Usare un reverse proxy (Traefik, Caddy)
- Abilitare HTTPS
- Database gestito su AWS RDS (no database locale)
- Impostare CORS_ORIGINS correctly