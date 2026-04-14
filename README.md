# Proxmox Cluster Dashboard

Dashboard di monitoraggio per cluster Proxmox con 3 nodi.

## Requisiti

- Docker >= 20.10
- Docker Compose >= 2.0

## Configurazione

1. Copia `.env.example` in `.env` e modifica le credenziali:

```bash
cp .env.example .env
nano .env
```

2. Modifica le variabili:
   - `PROXMOX_PASSWORD` - Password del tuo server Proxmox
   - `SECRET_KEY` - Chiave segreta per JWT (cambiala in produzione!)

## Avvio

```bash
# Build e avvio
docker-compose up -d

# Oppure con build automatico
docker-compose up --build -d
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
| `DB_PATH` | Path database | /app/data/dashboard.db |
| `PROXMOX_NODES` | Nodi Proxmox (JSON) | 3 nodi default |
| `PROXMOX_USER` | Utente Proxmox | root@pam |
| `PROXMOX_PASSWORD` | Password Proxmox | (richiesto) |
| `SECRET_KEY` | Chiave JWT | (generato) |
| `PROXMOX_VERIFY_SSL` | Verifica SSL | false |

## Produzione

Per produzione, considera:
- Usare un reverse proxy (Traefik, Caddy)
- Abilitare HTTPS
- Usare external volume per il database
- Impostare CORS_ORIGINS correctly