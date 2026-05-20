# Ollama Chat Console

A self-hosted AI chat platform with JWT-authenticated REST API, MongoDB persistence, and a React web UI. Supports two deployment modes:

- **Local** — single Ubuntu machine with optional GPU (NVIDIA/AMD/CPU)
- **Cluster** — two-node K3s (lightweight Kubernetes) setup

---

## Quick Start

```bash
# Enter the directory
cd ollama/

# First run — script will prompt you to choose a mode and save it to .run-mode
./run.sh setup

# Or specify mode explicitly (overrides saved .run-mode)
sudo ./run.sh --local setup
./run.sh --cluster setup
```

---

## Architecture

### Local Mode

```
Browser  →  http://<machine-ip>:8080
             nginx (port 8080)
             ├── /         → /var/www/ollama-chat  (React SPA)
             └── /api/     → localhost:5000        (Express backend)

localhost:5000   ← ollama-backend.service (systemd)
localhost:11434  ← ollama.service         (systemd)
localhost:27017  ← mongod.service         (systemd, MongoDB 7)
```

### Cluster Mode

```
Browser  →  http://172.16.9.203:30080
             K3s NodePort → ollama-frontend pod (nginx, React SPA)
             /api/ → ollama-backend pod (Express, port 30500)

ollama-backend pod  →  ollama-svc (NodePort 31434, 2 replicas)
                    →  mongodb svc (NodePort 30017, 1 replica)
```

| Node       | IP            | Role       |
|------------|---------------|------------|
| vm1-master | 172.16.9.203  | K3s master |
| vm2-worker | 172.16.9.253  | K3s worker |

---

## Configuration (`config.json`)

All settings live in one file. Edit before running `setup`.

```json
{
  "cluster": {
    "master":  { "ip": "172.16.9.203", "hostname": "vm1-master" },
    "worker":  { "ip": "172.16.9.253", "hostname": "vm2-worker" },
    "ssh":     { "user": "root", "password": "jkljkl" },
    "k3s":     { "version": "v1.29.4+k3s1", "token": "ollama-k3s-cluster-token" }
  },
  "ollama": {
    "replicas": 2,
    "nodeport": 31434,
    "cpu_limit": "8",
    "memory_limit": "16Gi",
    "models": ["llama3:8b", "qwen3:8b", "gemma3:4b", "llava:7b", "..."]
  },
  "mongodb": {
    "enabled": true,
    "nodeport": 30017,
    "database": "ollama_chat",
    "username": "ollamaadmin",
    "password": "mongopass123"
  },
  "backend": {
    "port": 5000,
    "jwt_secret": "change-this-in-production-...",
    "jwt_expiry": "24h",
    "smtp": { "host": "", "port": 587, "user": "", "pass": "", "from": "noreply@ollama.local" }
  },
  "local": {
    "web_port": 8080,
    "ollama_port": 11434,
    "backend_port": 5000
  },
  "users": [
    { "username": "admin",     "password": "admin123", "role": "admin", "email": "admin@ollama.local" },
    { "username": "telaverge", "password": "tela123",  "role": "user",  "email": "telaverge@ollama.local" }
  ]
}
```

### Key settings

| Field | Description |
|---|---|
| `cluster.ssh` | Credentials used to SSH into both nodes (cluster mode only) |
| `ollama.models` | Models pulled during `setup` / `sync-models` |
| `backend.jwt_secret` | Change this before production use |
| `backend.smtp` | Leave `host` empty to print OTPs to console (dev mode) |
| `local.web_port` | nginx port in local mode (default 8080) |
| `users` | Seeded on first `setup` via `sync-users` |

---

## Local Mode

### Prerequisites

- Ubuntu 20.04+ with internet access
- Run as **root** (or `sudo`)
- (Optional) NVIDIA or AMD GPU

### What `setup` installs

| Component | Version | Method |
|-----------|---------|--------|
| Node.js   | 20.x    | NodeSource apt repo |
| MongoDB   | 7.0     | Official MongoDB apt repo |
| Ollama    | latest  | `curl ollama.ai/install.sh` |
| nginx     | system  | `apt-get install nginx` |

GPU is auto-detected:
- `nvidia-smi` found → Ollama uses CUDA
- `rocm-smi` found → Ollama uses ROCm
- Neither → CPU mode (slower but works)

### Local commands

```bash
sudo ./run.sh setup            # Full install (deps + services + models + users)
sudo ./run.sh deploy-backend   # Reinstall npm deps and restart backend service
sudo ./run.sh deploy-frontend  # Rebuild React app and copy to /var/www/ollama-chat
./run.sh sync-models           # Pull all models listed in config.json
./run.sh sync-users            # Create/update all users from config.json
./run.sh add-user <name>       # Add a specific user from config.json
./run.sh remove-user <name>    # Delete a user and their conversations
./run.sh status                # Show service status, installed models, and health
./run.sh logs                  # Tail backend logs (journalctl)
./run.sh logs ollama           # Tail Ollama service logs
./run.sh restart               # Restart all services
./run.sh restart backend       # Restart only the backend
./run.sh restart nginx         # Reload nginx
./run.sh uninstall             # Remove deployment (keeps MongoDB data and models)
```

### Ports (local mode)

| Service  | Port  | Description |
|----------|-------|-------------|
| Web UI   | 8080  | nginx (React SPA + API proxy) |
| Backend  | 5000  | Express API (internal) |
| Ollama   | 11434 | Ollama inference (internal) |
| MongoDB  | 27017 | MongoDB (internal) |

### Systemd services

```bash
systemctl status ollama-backend   # Backend API
systemctl status ollama           # Ollama inference
systemctl status mongod           # MongoDB
systemctl status nginx            # Web server

journalctl -u ollama-backend -f   # Live backend logs
journalctl -u ollama -f           # Live Ollama logs
```

### nginx config

Written to `/etc/nginx/sites-available/ollama-chat`. Routes:
- `http://<ip>:8080/`      → React SPA at `/var/www/ollama-chat`
- `http://<ip>:8080/api/`  → Express backend at `localhost:5000`

---

## Cluster Mode

### Prerequisites

- Two Ubuntu VMs with SSH access (root)
- `sshpass`, `docker`, `python3`, `npm` installed on the machine running `run.sh`
- IPs configured in `config.json → cluster`

### Cluster commands

```bash
./run.sh setup              # K3s install + all pods + models + users
./run.sh deploy-backend     # Rebuild Docker image + rollout restart
./run.sh deploy-frontend    # Rebuild Docker image + rollout restart
./run.sh sync-models        # Pull models on all Ollama pods
./run.sh sync-users         # Seed users from config.json
./run.sh add-user <name>    # Add a user from config.json
./run.sh remove-user <name> # Delete user and conversations
./run.sh status             # Nodes, pods, models, backend health
./run.sh logs               # Tail backend pod logs
./run.sh uninstall          # Remove K3s from all nodes
```

### Cluster ports

| Service    | NodePort | Description |
|------------|----------|-------------|
| Frontend   | 30080    | React SPA (nginx inside pod) |
| Backend    | 30500    | Express REST API |
| Ollama     | 31434    | Inference service (2 pods) |
| MongoDB    | 30017    | Database |

### Image deployment

Docker images are built locally, saved as `.tar`, and imported into **both** nodes via `k3s ctr images import` — no Docker registry needed.

---

## Features

### Chat
- Multi-model selector grouped by family (Qwen3, Qwen2.5, Gemma3, DeepSeek-R1, etc.)
- Full conversation history sent to Ollama on every message
- System prompt, temperature, top_p, max_tokens — all respected
- File/image upload (PDF text extraction + image vision)
- Vision routing: gemma3:4b and gemma3:12b handle images natively; other models auto-route to gemma3:12b
- Voice input (HTTPS required for browser SpeechRecognition API)

### Auth
- JWT login with configurable expiry
- Forgot password: 3-step email OTP flow
  - Step 1: enter email
  - Step 2: 6-digit OTP with 60-second countdown
  - Step 3: set new password with strength indicator
  - OTPs stored in MongoDB with TTL auto-expiry (10 min)
  - If no SMTP configured, OTP is printed to the backend console

### Admin (admin role only)
- Create and delete users
- View all users and their conversations

### API Docs tab
- All backend endpoints documented in the UI
- curl examples, payload schemas, copy buttons, search/filter

### Cluster view
- Node status, pod list, resource usage
- Data from Kubernetes in-cluster API via service account token

---

## File Structure

```
ollama/
├── config.json               ← All settings (edit this first)
├── run.sh                    ← Management script (local + cluster)
├── .run-mode                 ← Saved mode: "local" or "cluster" (auto-created)
├── README.md
└── chat-app/
    ├── backend/
    │   ├── server.js         ← Express API (auth, chat, admin, cluster status)
    │   ├── package.json
    │   └── Dockerfile
    └── frontend/
        ├── src/
        │   ├── App.tsx       ← React app (Login, Chat, Cluster, Models, Admin, API Docs)
        │   └── App.css       ← Design system (CSS variables, dark theme)
        └── public/
            └── index.html
```

---

## SMTP / Email (optional)

Configure `backend.smtp` in `config.json` for forgot-password OTP emails:

```json
"smtp": {
  "host": "smtp.gmail.com",
  "port": 587,
  "user": "you@gmail.com",
  "pass": "app-password",
  "from": "noreply@yourapp.com"
}
```

Leave `host` empty during development — the OTP prints to the backend log instead.

---

## Default Users

Seeded from `config.json → users` on `setup` / `sync-users`:

| Username  | Password | Role  |
|-----------|----------|-------|
| admin     | admin123 | admin |
| telaverge | tela123  | user  |

Change passwords after first login via Settings, or update `config.json` and re-run `./run.sh sync-users`.

---

## Included Models

All models in `config.json` are pulled on `setup` and `sync-models`:

| Family | Models |
|--------|--------|
| Qwen3 (latest) | qwen3:0.6b, 1.7b, 4b, 8b |
| Qwen2.5 | qwen2.5:3b, 7b |
| Gemma3 (vision) | gemma3:4b, 12b |
| Gemma3n | gemma3n:e2b, e4b |
| DeepSeek-R1 | deepseek-r1:1.5b, 7b, 8b |
| Legacy | llama3:8b, gemma:7b, gemma2:2b |
| Vision | llava:7b |

Default chat model: **qwen3:8b**
