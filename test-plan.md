# Test plan — PWMO (Proxmox Web Management Orchestrator)

**Riferimento:** specifica di progetto *Project Work: Proxmox Web Management Orchestrator (PWMO)* (documento **SYAM_A1_PROJECT_WORK.pdf**, INFORMIX Spa).

**Scopo del documento:** attestare il corretto funzionamento delle **chiamate API** e delle verifiche funzionali collegate al portale.

**Prodotto sotto test:** repository **ProxMox_Dashboard** — backend **FastAPI** (`backend/main.py`, `backend/api/`), frontend **React** servito via Docker, persistenza **PostgreSQL su AWS RDS**, segreti da **AWS Secrets Manager**, immagini **AWS ECR** (vedi `docker-compose.yml` e `README.md`).

---

## 1. Ambiente e prerequisiti di test

| Elemento | Requisito |
|----------|-----------|
| Stack | `docker compose up -d`; backend healthy prima del frontend (`depends_on` + healthcheck su `/api/health`) |
| Rete | Host raggiunge RDS e cluster Proxmox; AWS credentials valide per Secrets Manager |
| Proxmox | Token API **`PVEAPIToken=...`** configurato (no password root in chiaro, come da nota tecnica PDF) |

---

## 2. Matrice di tracciabilità

| # | Requisito (Livello 1 / PDF) | Come si verifica nel progetto |
|---|-----------------------------|-------------------------------|
| R1 | Dashboard di stato: CPU, RAM, storage nodo | `GET /api/cluster/summary`, `GET /api/cluster/all`; UI Overview |
| R2 | Inventario VM/CT con ID e nomi | `GET /api/cluster/vms`, `GET /api/cluster/containers`, `GET /api/cluster/resources`, `GET /api/cluster/all` |
| R3 | Power: Start, Stop, Shutdown, Reboot | `POST /api/vms/{node}/{vmid}/{action}`, `POST /api/containers/{node}/{vmid}/{action}` con azioni ammesse |
| R4 | Monitoraggio risorse (es. ultimi 30 min) | `GET /api/metrics/history` (parametro `hours`), aggiornamenti `WebSocket /ws` (`metrics_update`) |
| R5 | Trigger backup manuale verso PBS / storage backup | `POST /api/backup/trigger/{node}/{vmid}` con body `storage`, `mode`; `vtype` query |
| R6 | Storico backup per VM | `GET /api/backup/history/{node}/{vmid}` |
| R7 | DB esterno (RDS), non DB locale nel container di produzione | Avvio applicativo con RDS; `GET /api/health` (`database`: ok) |
| R8 | Secrets Manager all’avvio (no segreti sensibili solo da `.env` in produzione) | Startup backend esegue caricamento config da secret; assenza di crash se configurazione corretta |
| R9 | Immagini Docker su ECR | `docker compose` usa immagini ECR; pipeline build/tag/push documentata (verifica processo + pull) |
| R10 | **Error handling PBS irraggiungibile**: app non in crash, **avviso** utente | `GET /api/backup/history/...` restituisce `warning` e/o elenchi vuoti anziché eccezioni non gestite |
| **Bonus** | Cluster awareness | `GET /api/cluster/all?cluster_id=`, API `/api/clusters`, `/api/nodes`, filtri cluster |
| **Bonus** | Live migration | `POST /api/vms/{node}/{vmid}/migrate`, `POST /api/containers/{node}/{vmid}/migrate` |

---

## 3. Test funzionali — API REST

### 3.1 Salute applicativa e integrazione DB

| ID | Caso di test | Passi | Esito atteso |
|----|----------------|-------|----------------|
| T-HLTH-01 | Health dopo avvio stack | `GET /api/health` | `status` ok, `database` ok, versione app valorizzata |
| T-HLTH-02 | Conteggio nodi | Risposta include `nodes_configured`, `nodes_connected` coerenti con ambiente |

### 3.2 Autenticazione utenti (credenziali su database)

| ID | Caso di test | Passi | Esito atteso |
|----|----------------|-------|----------------|
| T-AUTH-01 | Login valido | `POST /api/auth/login` JSON `username`, `password` | `200`, `access_token`, `role` |
| T-AUTH-02 | Login invalido | Credenziali errate | `401`, messaggio coerente |
| T-AUTH-03 | Profilo con JWT | `GET /api/auth/me` con header `Authorization: Bearer <token>` | Dati utente |
| T-AUTH-04 | Logout | `POST /api/auth/logout` con Bearer | `200` |
| T-AUTH-05 | Refresh token | `POST /api/auth/refresh` con Bearer | Nuovo `access_token` |

### 3.3 Cluster, nodi e inventario (core Proxmox)

| ID | Caso di test | Passi | Esito atteso |
|----|----------------|-------|----------------|
| T-CLU-01 | Riepilogo cluster | `GET /api/cluster/summary` | Struttura con nodi e metriche aggregate attese |
| T-CLU-02 | Lista nodi | `GET /api/cluster/nodes` | Elenco `nodes` |
| T-CLU-03 | Salute cluster | `GET /api/cluster/health` (opz. `cluster_id`) | Risposta senza 500; dati coerenti |
| T-CLU-04 | VM globali | `GET /api/cluster/vms` e con `?node=<nome>` | Filtro per nodo se applicato |
| T-CLU-05 | Container globali | `GET /api/cluster/containers` | Elenco CT |
| T-CLU-06 | Risorsa aggregata | `GET /api/cluster/all` | `summary`, `vms`, `containers`; test filtri `cluster_id`, `standalone` |
| T-NODE-01 | CRUD nodi (persistenza DB) | `GET/POST/PUT/DELETE /api/nodes`, `GET /api/nodes/{node_name}` | CRUD secondo permessi ambiente |
| T-CLS-01 | CRUD cluster logici | `/api/clusters` (GET/POST/PUT/DELETE) | Allineamento multi-cluster (bonus) |

### 3.4 Power management (VM e LXC)

| ID | Caso di test | Passi | Esito atteso |
|----|----------------|-------|----------------|
| T-PWR-01 | Azione VM ammessa | `POST /api/vms/{node}/{vmid}/start` (o stop/shutdown/reboot) | `200`, `success`, `task` se Proxmox accetta |
| T-PWR-02 | Azione VM non valida | `POST` con azione non in elenco | `400` |
| T-PWR-03 | Nodo assente | VMID su nodo inesistente | `404` / `503` come da implementazione |
| T-PWR-04 | Azione CT | `POST /api/containers/{node}/{vmid}/{action}` | Stesso schema delle VM per azioni CT |

*Nota:* in ambiente condiviso usare VM/CT di test o confermare impatto operativo prima di eseguire stop/shutdown.

### 3.5 Metriche e log

| ID | Caso di test | Passi | Esito atteso |
|----|----------------|-------|----------------|
| T-MET-01 | Storico metriche | `GET /api/metrics/history?hours=1` e `&node=<nome>` | Array `data` con campi attesi da DB |
| T-WS-01 | WebSocket | Connessione a `ws://.../ws` | Messaggio iniziale `connected`; eventuali `metrics_update` / `ping`→`pong` |
| T-LOG-01 | Log realtime | `GET /api/logs/realtime` | `logs` presenti o vuoti senza crash |

### 3.6 Backup e PBS / storage backup

| ID | Caso di test | Passi | Esito atteso |
|----|----------------|-------|----------------|
| T-BKP-01 | Storico backup VM | `GET /api/backup/history/{node}/{vmid}` | Lista `backups`; se problemi storage: campo `warning`, non crash server |
| T-BKP-02 | Trigger backup | `POST /api/backup/trigger/{node}/{vmid}` body `{"storage":"<id>","mode":"snapshot"}` | `200` con `result` oppure errore HTTP gestito con messaggio |
| T-BKP-03 | Lista job backup | `GET /api/backup/jobs` | `jobs` |
| T-BKP-04 | Storage backup disponibili | `GET /api/backup/storages` | Elenco tipi `pbs`, `dir`, ecc. |
| T-BKP-05 | **PBS irraggiungibile** (PDF) | Simulare storage offline o errore API Proxmox | Risposta con `warning` / backup vuoti; processo API ancora raggiungibile (`GET /api/health` ok) |

### 3.7 Snapshot

| ID | Caso di test | Passi | Esito atteso |
|----|----------------|-------|----------------|
| T-SNAP-01 | Lista snapshot | `GET /api/snapshots/{node}/{vmid}?vtype=qemu` (o lxc) | `snapshots`, `count` |
| T-SNAP-02 | Creazione snapshot | `POST` con `snapname` obbligatorio | `200` o errore esplicito da Proxmox |

### 3.8 Bonus: migrazione

| ID | Caso di test | Passi | Esito atteso |
|----|----------------|-------|----------------|
| T-MIG-01 | Migrazione VM | `POST /api/vms/{node}/{vmid}/migrate` body `target_node`, `online` | Validazione stesso cluster; `503` se nodo offline |
| T-MIG-02 | Migrazione CT | `POST /api/containers/.../migrate` | Come sopra per LXC |

### 3.9 Ulteriori endpoint

| Area | Endpoint (estratti) | Nota |
|------|---------------------|------|
| Storage | `GET /api/storage`, `POST /api/storage/refresh` | Cache invalidation |
| Task | `GET /api/tasks` | Code operazioni Proxmox |
| Alert | `GET /api/alerts`, `POST /api/alerts/{id}/resolve` | Monitoraggio |
| Budget / costi | `GET/POST /api/budget`, `/api/cost-config` | Funzioni aggiuntive oltre il minimo PDF |
| Governance | `GET /api/governance/users`, … | Utenti e audit |

---

## 4. Criteri di superamento e registrazione esiti

- **Superato:** risposta HTTP coerente con la specifica dell’endpoint, assenza di crash del processo backend, per il caso PBS irraggiungibile presenza di **warning** o lista vuota senza errore fatale.
- **Fallito:** eccezione non gestita che termina il worker, risposta sempre `500` senza messaggio per errori di storage attesi, credenziali sensibili esposte in repository.

**Registro esiti (modello):**

| Data | Tester | ID test | Esito (Pass/Fail) | Note / build / commit |
|------|--------|---------|---------------------|------------------------|
| | | | | |

---

## 5. Riferimenti rapidi endpoint principali

```
GET  /api/health
POST /api/auth/login
GET  /api/cluster/summary
GET  /api/cluster/all
GET  /api/cluster/vms
GET  /api/cluster/containers
POST /api/vms/{node}/{vmid}/{action}
POST /api/containers/{node}/{vmid}/{action}
GET  /api/metrics/history
GET  /api/backup/history/{node}/{vmid}
POST /api/backup/trigger/{node}/{vmid}
WS   /ws
```
