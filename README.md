# Ollama Cluster Console

A self-hosted AI chat platform running on a two-node K3s (lightweight Kubernetes) cluster with Ollama LLM inference, JWT-authenticated REST API, MongoDB chat persistence, and a React web UI.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│  Client Browser  →  http://172.16.9.203:3000                 │
│  (React SPA)         Nginx serves compiled frontend          │
└─────────────────────────────┬────────────────────────────────┘
                              │ REST API
┌─────────────────────────────▼────────────────────────────────┐
│  Backend  →  http://172.16.9.203:5000                        │
│  Node.js + Express                                           │
│  · JWT auth (jsonwebtoken + bcryptjs)                        │
│  · PDF/file extraction (multer + pdf-parse)                  │
│  · Cluster status via kubectl                                │
│  · Model routing (auto-switch to llava:7b for images)        │
└──────────┬──────────────────────────┬────────────────────────┘
           │                          │
┌──────────▼──────────┐   ┌──────────▼──────────────────────┐
│  MongoDB            │   │  Ollama (K3s NodePort 31434)     │
│  K3s NodePort 30017 │   │  2 replicas, pod anti-affinity   │
│  1 replica          │   │  → pod on vm1-master             │
│  Stores:            │   │  → pod on vm2-worker             │
│  · Users + hashes   │   │  Models stored per-pod (emptyDir)│
│  · Conversations    │   └──────────────────────────────────┘
│  · Messages         │
└─────────────────────┘
```

### Nodes

| Node        | IP            | Role        | Description                        |
|-------------|---------------|-------------|------------------------------------|
| vm1-master  | 172.16.9.203  | K3s master  | Runs nginx, backend, 1 Ollama pod  |
| vm2-worker  | 172.16.9.253  | K3s worker  | Runs 1 Ollama pod                  |

### Ports

| Service         | Port  | Type      | Description                            |
|-----------------|-------|-----------|----------------------------------------|
| Frontend        | 3000  | HTTP      | Nginx serving compiled React SPA       |
| Backend API     | 5000  | HTTP      | Express REST API with JWT auth         |
| Ollama NodePort | 31434 | NodePort  | Ollama inference service (K3s)         |
| MongoDB NodePort| 30017 | NodePort  | MongoDB database (K3s)                 |

---

## File Structure

```
ollama/
├── config.json               ← Master configuration (edit this)
├── run.sh                    ← Single management script
├── README.md                 ← This file
└── chat-app/
    ├── backend/
    │   ├── server.js         ← Express API (JWT, MongoDB, Ollama proxy)
    │   └── package.json      ← Node.js dependencies
    └── frontend/
        ├── src/
        │   ├── App.tsx       ← React app (Login, Chat, Cluster, Models, Admin)
        │   └── App.css       ← All styling (CSS variables, dark/light theme)
        └── public/
            └── index.html    ← HTML entry point (Google Fonts loaded here)
```

---

## Configuration (`config.json`)

All cluster settings live in one file. Edit before running `./run.sh setup`.

### `cluster`
```json
"cluster": {
  "master": { "ip": "172.16.9.203", "hostname": "vm1-master" },
  "worker":  { "ip": "172.16.9.253", "hostname": "vm2-worker" },
  "ssh":     { "user": "root", "password": "jkljkl" },
  "k3s":     { "version": "v1.29.4+k3s1", "token": "ollama-k3s-cluster-token" }
}
```
- `master.ip` — IP of the master node (runs nginx, backend, etcd)
- `worker.ip` — IP of the worker node (extra Ollama replica)
- `ssh` — credentials used by `run.sh` to SSH into both nodes
- `k3s.token` — shared secret K3s uses to join nodes into a cluster

### `ollama`
```json
"ollama": {
  "replicas": 2,
  "nodeport": 31434,
  "cpu_limit": "8",
  "memory_limit": "16Gi",
  "models": ["llama3:8b", "llava:7b", "gemma:7b", "gemma2:2b", "gemma3:4b", "qwen2.5:3b"]
}
```
- `replicas` — number of Ollama pods (current: 2, one per node via pod anti-affinity)
- `nodeport` — port exposed on every node to reach Ollama API (host network)
- `cpu_limit` / `memory_limit` — K8s resource limits per Ollama pod
  - `8` CPUs and `16Gi` RAM: sized for llava:7b (~12 GiB resident) with headroom
- `models` — list of Ollama model names to pull on every pod
  - Add/remove entries and run `./run.sh sync-models` to apply

### `mongodb`
```json
"mongodb": {
  "enabled": true,
  "nodeport": 30017,
  "database": "ollama_chat",
  "username": "ollamaadmin",
  "password": "mongopass123"
}
```
- `enabled` — set to `false` to skip MongoDB deploy (backend runs without persistence)
- `nodeport` — K3s NodePort for MongoDB; backend uses `localhost:30017` from master node
- `database` — MongoDB database name used for users and conversations
- `username` / `password` — MongoDB root credentials (`authSource=admin`)

### `backend`
```json
"backend": {
  "port": 5000,
  "jwt_secret": "change-this-in-production-use-a-long-random-string-32chars",
  "jwt_expiry": "24h",
  "max_upload_size": "50mb"
}
```
- `jwt_secret` — **change this before deploying**. Used to sign/verify JWT tokens.
- `jwt_expiry` — how long tokens stay valid (e.g. `24h`, `7d`)
- `max_upload_size` — body-parser and multer limit for file uploads

### `users`
```json
"users": [
  { "username": "admin",      "password": "admin123", "role": "admin", "email": "admin@ollama.local" },
  { "username": "telaverge",  "password": "tela123",  "role": "user",  "email": "telaverge@ollama.local" }
]
```
- `role` — either `"admin"` (full access + user management) or `"user"`
- Add users here then run `./run.sh sync-users` or `./run.sh add-user <name>`

---

## Management Script (`run.sh`)

Single entry point for all cluster operations.

### Commands

#### `./run.sh setup`
Full cluster installation from scratch:
1. Installs K3s on master node
2. Joins worker node to the cluster
3. Deploys MongoDB pod (K8s Deployment + NodePort Service)
4. Deploys Ollama pod(s) with anti-affinity (K8s Deployment + NodePort Service)
5. Pulls all models listed in `config.json` onto every Ollama pod
6. Installs backend Node.js dependencies, copies to master, starts with `nohup`
7. Builds React frontend (`npm run build`), tars, scps, extracts to `/var/www/html/`, restarts nginx
8. Creates all users from `config.json` in MongoDB via the backend API

#### `./run.sh uninstall`
Removes everything. Prompts for confirmation (`yes`).
- Runs `k3s-uninstall.sh` on master (removes K3s, all pods, all persistent data)
- Runs `k3s-agent-uninstall.sh` on worker
- Kills backend Node.js process
- Clears `/var/www/html/` and restarts nginx

#### `./run.sh status`
Shows:
- `kubectl get nodes -o wide` (node roles, IPs, K8s versions)
- `kubectl get pods -A` (all pods across all namespaces)
- Ollama model list from the API
- Backend health (MongoDB connected, Ollama reachable)

#### `./run.sh sync-models`
Reads `config.json → ollama.models`, gets all running Ollama pods, and pulls any missing model on each pod. Models already present are skipped. Pulls run in parallel across pods.

**To add a model**: add its name to `config.json → ollama.models`, then run `./run.sh sync-models`.
**To remove a model**: remove it from the list. (Note: `sync-models` does NOT auto-delete installed models — this is intentional to avoid accidentally removing large downloads. Delete manually via `kubectl exec <pod> -- ollama rm <model>`.)

#### `./run.sh sync-users`
Creates all users from `config.json → users` in the MongoDB database via the backend API. Skips users that already exist (409 response). Run this after first setup or when you add users to the config.

#### `./run.sh add-user <username>`
Looks up `<username>` in `config.json → users` and creates that single user in MongoDB.

**Example**: Add user to config first, then:
```bash
./run.sh add-user alice
```

#### `./run.sh remove-user <username>`
Deletes the user from MongoDB. Also deletes all their conversations and messages.

```bash
./run.sh remove-user alice
```

#### `./run.sh deploy-backend`
Reinstalls Node.js dependencies locally, copies `server.js` + `node_modules` to master via SCP, kills old process, starts new one with environment variables from `config.json`. Does NOT restart nginx.

#### `./run.sh deploy-frontend`
Runs `npm run build` locally, tars the build output, SCPs to master, extracts to `/var/www/html/`, restarts nginx. Use this after any UI changes.

#### `./run.sh logs`
Tails `/root/backend/server.log` on the master node in real time.

---

## Backend API (`chat-app/backend/server.js`)

### Authentication

All routes (except `/health` and `/api/auth/login`) require a JWT token in the `Authorization` header:
```
Authorization: Bearer <token>
```

#### `POST /api/auth/login`
```json
Request:  { "username": "admin", "password": "admin123" }
Response: { "token": "eyJ...", "user": { "id": "...", "username": "admin", "role": "admin" } }
```

#### `GET /api/auth/me`
Returns current user profile (validates token).

### Conversations

#### `GET /api/conversations`
Returns list of conversations for the logged-in user, sorted by `updatedAt` descending. Does NOT include messages (loaded on demand).

#### `POST /api/conversations`
Creates a new empty conversation.
```json
Request:  { "model": "llama3:8b" }
Response: { "_id": "...", "title": "New conversation", "model": "llama3:8b", ... }
```

#### `GET /api/conversations/:id`
Returns a full conversation including all messages.

#### `DELETE /api/conversations/:id`
Permanently deletes a conversation and all its messages.

#### `POST /api/conversations/:id/messages`
Sends a message and returns the AI reply. Uses multipart FormData.

| Field   | Type     | Description                              |
|---------|----------|------------------------------------------|
| message | string   | User text                                |
| model   | string   | Ollama model name (optional, uses conv default) |
| files   | file[]   | PDF or text files (content extracted and prepended as context) |
| images  | base64[] | Image files (triggers llava:7b routing)  |

Returns: `{ "reply": "...", "model": "llama3:8b", "latency": "4217ms" }`

Saves both the user message and assistant reply to MongoDB. Auto-titles the conversation using the first user message (first 60 chars).

**Model routing**: if any image is attached, the model is automatically switched to `llava:7b` regardless of the `model` field.

### Admin (role: admin only)

#### `GET /api/admin/users`
Returns all users (excluding password hashes).

#### `POST /api/admin/users`
```json
{ "username": "alice", "password": "secret", "role": "user", "email": "alice@example.com" }
```

#### `DELETE /api/admin/users/:id`
Deletes user and all their conversations. Cannot delete your own account.

#### `PATCH /api/admin/users/:id/password`
```json
{ "password": "newpassword" }
```

### Cluster Info

#### `GET /api/cluster/status`
Runs `k3s kubectl get nodes/pods` on the host and queries Ollama API. Returns:
```json
{
  "nodes": [{ "name": "vm1-master", "role": "master", "status": "Ready", "cpu": "8", "memory": "16Gi" }],
  "pods": [{ "name": "ollama-xxx", "namespace": "default", "status": "Running", "ready": "1/1", "restarts": 0 }],
  "models": [{ "name": "llama3:8b", "size": 4661224676 }]
}
```

#### `GET /api/models`
Returns installed Ollama models from the API.

#### `GET /health`
Public health check. Returns MongoDB and Ollama connectivity status.

---

## Frontend (`chat-app/frontend/src/App.tsx`)

### Views

| View    | Description                                                      |
|---------|------------------------------------------------------------------|
| Chat    | Main conversation interface. Supports text, files, images, STT  |
| Cluster | Real-time cluster status: nodes, pods, models (from API)        |
| Models  | List of installed Ollama models with size and type              |
| Admin   | User management table (admin role only)                         |

### Login
When `localStorage.ollama_token` is absent or expired, the full-page login form is shown. On successful login, the token is stored in `localStorage` and conversations are loaded.

### Chat history
Conversations are loaded from `/api/conversations` on login. Messages are lazy-loaded when a conversation is selected (fetched via `/api/conversations/:id`). New conversations are created via the API when "New chat" is clicked.

### Streaming effect
The AI reply is displayed word-by-word using a simulated streaming animation (16–30ms per word). This is client-side only — the backend returns the full response at once (Ollama's `stream: false`).

### STT / TTS
- **Speech-to-text**: Web Speech API (`SpeechRecognition`). Click the mic button, speak, and the transcript fills the input field. Chrome/Edge only.
- **Text-to-speech**: `window.speechSynthesis`. Enable in Settings → TTS Voice. Reads out the first 400 characters of each AI reply.

### File uploads
- **PDF** — text is extracted server-side and prepended to the prompt as context
- **Plain text files** — read and prepended as context
- **Images** — sent as base64 to Ollama; automatically routes to `llava:7b`

### Theme and Density
Controlled via CSS custom properties on `<html>`:
- `data-theme="dark|light"` — dark uses `#0c0c0d` background, light uses `#f7f5f0`
- `data-density="compact|regular|comfy"` — adjusts top-bar height (44/52/60px) and message gap (11/16/24px)

### Design tokens (App.css)
```css
--bg:       #0c0c0d    /* main background */
--bg-elev:  #141415    /* elevated surfaces */
--line:     #2a2a2b    /* borders */
--ink:      #f0ede8    /* primary text */
--ink-3:    #888       /* tertiary text */
--bone:     #efe7d7    /* cream accent (buttons, highlights) */
--signal:   #7dd87a    /* green for status indicators */
--font-sans: "Geist", ui-sans-serif
--font-mono: "Geist Mono", ui-monospace
--font-serif:"Instrument Serif"
```

---

## Ollama Deployment Details

### K8s Deployment spec
- **Replicas**: 2 (configurable in `config.json`)
- **Anti-affinity**: `podAntiAffinity preferredDuringScheduling` with `topologyKey: kubernetes.io/hostname` — K3s scheduler tries to place each pod on a different node
- **Resources**: 8 CPU / 16Gi RAM per pod (limits)
- **Storage**: `emptyDir` volume at `/root/.ollama` — models are stored in-pod, so each pod needs its own copy pulled (handled by `sync-models`)
- **Service type**: NodePort on 31434 — accessible from host network on all nodes

### Why emptyDir vs PersistentVolume?
`emptyDir` was chosen for simplicity (no NFS or hostPath setup needed). Tradeoff: if a pod restarts, its model files are lost and must be re-pulled. For production, replace with a `PersistentVolumeClaim` backed by local storage or NFS.

### Model routing logic (backend)
```
User sends message
  ├── has images? → model = llava:7b (forced, regardless of settings)
  └── no images?  → model = user-selected model from request body
```
Image base64 strings are stripped of the `data:image/*;base64,` prefix before sending to Ollama.

### Model sizes (approximate)
| Model      | Size   | Type   | Context | Notes                            |
|------------|--------|--------|---------|----------------------------------|
| llama3:8b  | 4.7 GB | text   | 128k    | Default, fast, general purpose   |
| llava:7b   | 4.7 GB | vision | 4k      | Auto-selected for image inputs   |
| gemma:7b   | 5.0 GB | text   | 8k      | Google Gemma 1.1                 |
| gemma2:2b  | 1.6 GB | text   | 8k      | Lightweight, fast responses      |
| gemma3:4b  | 3.3 GB | text   | 128k    | Google Gemma 3, 128k context     |
| qwen2.5:3b | 2.0 GB | text   | 128k    | Alibaba Qwen 2.5, strong coder   |

---

## MongoDB Data Model

### Collection: `users`
```json
{
  "_id": ObjectId,
  "username": "admin",
  "passwordHash": "$2b$12$...",   // bcrypt, 12 rounds
  "role": "admin",                // "admin" | "user"
  "email": "admin@ollama.local",
  "createdAt": ISODate,
  "lastLogin": ISODate
}
```

### Collection: `conversations`
```json
{
  "_id": ObjectId,
  "userId": ObjectId,             // references users._id
  "title": "What is k3s?",       // auto-set from first user message (60 chars)
  "model": "llama3:8b",
  "messages": [
    {
      "_id": ObjectId,
      "role": "user",
      "content": "What is k3s?",
      "model": "llama3:8b",
      "latency": null,
      "attachments": [],
      "createdAt": ISODate
    },
    {
      "_id": ObjectId,
      "role": "assistant",
      "content": "K3s is a lightweight...",
      "model": "llama3:8b",
      "latency": "4217ms",
      "attachments": [],
      "createdAt": ISODate
    }
  ],
  "createdAt": ISODate,
  "updatedAt": ISODate
}
```
Messages are embedded in conversations (no separate collection). This keeps full conversation retrieval as a single MongoDB query.

---

## Quick Start

### First-time setup
```bash
# 1. Edit config.json to match your cluster IPs and credentials
nano config.json

# 2. Run full setup (takes ~10 minutes on first pull)
chmod +x run.sh
./run.sh setup

# 3. Open browser
open http://172.16.9.203:3000
# Login with: admin / admin123
```

### Day-to-day operations
```bash
# Check everything is healthy
./run.sh status

# Add a new model (edit config.json first)
./run.sh sync-models

# Add a new user (add to config.json users[] first)
./run.sh add-user alice

# Remove a user
./run.sh remove-user alice

# Push frontend changes
./run.sh deploy-frontend

# Push backend changes
./run.sh deploy-backend

# View backend logs
./run.sh logs
```

### Changing a user's password
Use the Admin view in the UI (admin role required), or call the API:
```bash
# Get token
TOKEN=$(curl -s -X POST http://172.16.9.203:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['token'])")

# Get user ID
curl -s http://172.16.9.203:5000/api/admin/users \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Change password
curl -s -X PATCH http://172.16.9.203:5000/api/admin/users/<USER_ID>/password \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"password":"newpassword"}'
```
