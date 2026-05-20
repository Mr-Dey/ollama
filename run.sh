#!/usr/bin/env bash
# run.sh — Ollama Chat Manager (local & cluster modes)
# Usage: ./run.sh [--local|--cluster] <command> [args]

set -euo pipefail

# ─── Paths ───────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$SCRIPT_DIR/config.json"
MODE_FILE="$SCRIPT_DIR/.run-mode"
BACKEND_DIR="$SCRIPT_DIR/chat-app/backend"
FRONTEND_DIR="$SCRIPT_DIR/chat-app/frontend"

[[ ! -f "$CONFIG" ]] && { echo "ERROR: config.json not found at $CONFIG"; exit 1; }

# ─── Load .env (overrides config.json secrets) ────────────────────────────────

ENV_FILE="$SCRIPT_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

# ─── Config helpers ───────────────────────────────────────────────────────────

_cfg() { python3 -c "import json,sys; d=json.load(open('$CONFIG')); print(d$1)" 2>/dev/null || echo ""; }

# Override config value with env var if set: _env <env_name> <fallback>
_env() { local v="${!1:-}"; if [[ -n "$v" ]]; then echo "$v"; else echo "$2"; fi; }

MASTER_IP=$(_cfg "['cluster']['master']['ip']")
MASTER_HOSTNAME=$(_cfg "['cluster']['master']['hostname']")
WORKER_IP=$(_cfg "['cluster']['worker']['ip']")
WORKER_HOSTNAME=$(_cfg "['cluster']['worker']['hostname']")
SSH_USER=$(_cfg "['cluster']['ssh']['user']")
SSH_PASS=$(_env SSH_PASSWORD "$(_cfg "['cluster']['ssh']['password']")")
K3S_TOKEN=$(_cfg "['cluster']['k3s']['token']")

OLLAMA_REPLICAS=$(_cfg "['ollama']['replicas']")
OLLAMA_NODEPORT=$(_cfg "['ollama']['nodeport']")
OLLAMA_CPU=$(_cfg "['ollama']['cpu_limit']")
OLLAMA_MEM=$(_cfg "['ollama']['memory_limit']")

MONGO_ENABLED=$(_cfg "['mongodb']['enabled']")
MONGO_NODEPORT=$(_cfg "['mongodb']['nodeport']")
MONGO_DB=$(_cfg "['mongodb']['database']")
MONGO_USER=$(_env MONGO_USER "$(_cfg "['mongodb']['username']")")
MONGO_PASS=$(_env MONGO_PASS "$(_cfg "['mongodb']['password']")")

BACKEND_PORT=$(_cfg "['backend']['port']")
BACKEND_JWT=$(_env JWT_SECRET "$(_cfg "['backend']['jwt_secret']")")
BACKEND_JWT_EXP=$(_cfg "['backend']['jwt_expiry']")
SMTP_HOST=$(_env SMTP_HOST "$(_cfg "['backend']['smtp']['host']")")
SMTP_PORT=$(_env SMTP_PORT "$(_cfg "['backend']['smtp']['port']")")
SMTP_USER=$(_env SMTP_USER "$(_cfg "['backend']['smtp']['user']")")
SMTP_PASS=$(_env SMTP_PASS "$(_cfg "['backend']['smtp']['pass']")")
SMTP_FROM=$(_env SMTP_FROM "$(_cfg "['backend']['smtp']['from']")")

LOCAL_WEB_PORT=$(_cfg "['local']['web_port']")
LOCAL_HTTPS_PORT=$(_cfg "['local'].get('https_port', 8443)")
LOCAL_OLLAMA_PORT=$(_cfg "['local']['ollama_port']")
LOCAL_BACKEND_PORT=$(_cfg "['local']['backend_port']")
LOCAL_ENABLE_HTTPS=$(_cfg "['local'].get('enable_https', True)")

SSH="sshpass -p $SSH_PASS ssh -o StrictHostKeyChecking=no"
SCP="sshpass -p $SSH_PASS scp -o StrictHostKeyChecking=no"

# ─── Display helpers ──────────────────────────────────────────────────────────

log()  { echo -e "\033[1;36m▶ $*\033[0m"; }
ok()   { echo -e "\033[1;32m✓ $*\033[0m"; }
warn() { echo -e "\033[1;33m⚠ $*\033[0m"; }
err()  { echo -e "\033[1;31m✗ $*\033[0m"; exit 1; }
hdr()  { echo -e "\n\033[1;35m━━━ $* ━━━\033[0m"; }

# ─── Generate/strengthen secrets on first setup ───────────────────────────────

ensure_strong_jwt() {
  if [[ "$BACKEND_JWT" == "change-this-in-production-use-a-long-random-string-32chars" ]]; then
    warn "JWT_SECRET is still the default. Generating a strong one and saving to .env"
    local NEW_SECRET
    NEW_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | base64)
    if [[ ! -f "$ENV_FILE" ]]; then
      cp "$SCRIPT_DIR/.env.example" "$ENV_FILE" 2>/dev/null || touch "$ENV_FILE"
    fi
    if grep -q "^JWT_SECRET=" "$ENV_FILE"; then
      sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$NEW_SECRET|" "$ENV_FILE"
    else
      echo "JWT_SECRET=$NEW_SECRET" >> "$ENV_FILE"
    fi
    chmod 600 "$ENV_FILE"
    BACKEND_JWT="$NEW_SECRET"
    ok "JWT_SECRET written to .env (gitignored)"
  fi
}

# ─── Mode selection ───────────────────────────────────────────────────────────

MODE=""

# Parse leading --local / --cluster flag
if [[ "${1:-}" == "--local" ]]; then
  MODE="local"; shift
elif [[ "${1:-}" == "--cluster" ]]; then
  MODE="cluster"; shift
fi

# Fall back to saved mode
if [[ -z "$MODE" && -f "$MODE_FILE" ]]; then
  MODE=$(cat "$MODE_FILE")
fi

# Interactive prompt if still unknown
if [[ -z "$MODE" ]]; then
  echo ""
  echo "  ┌─────────────────────────────────────────────┐"
  echo "  │        Ollama Chat — Install Mode            │"
  echo "  ├─────────────────────────────────────────────┤"
  echo "  │  1) local    — Ubuntu machine with GPU       │"
  echo "  │               (installs Ollama, Mongo,       │"
  echo "  │                Node.js, nginx locally)       │"
  echo "  │                                              │"
  echo "  │  2) cluster  — Two-node K3s cluster          │"
  echo "  │               (172.16.9.203 + 172.16.9.253)  │"
  echo "  └─────────────────────────────────────────────┘"
  echo ""
  read -rp "  Choose mode [1=local / 2=cluster]: " _choice
  case "$_choice" in
    1|local)   MODE="local"   ;;
    2|cluster) MODE="cluster" ;;
    *) err "Invalid choice. Use 1 or 2." ;;
  esac
  echo "$MODE" > "$MODE_FILE"
  ok "Mode saved to .run-mode (override anytime with --local or --cluster)"
fi

# ─────────────────────────────────────────────────────────────────────────────
#  LOCAL MODE
# ─────────────────────────────────────────────────────────────────────────────

# ── GPU detection ─────────────────────────────────────────────────────────────

detect_gpu() {
  if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null; then
    echo "nvidia"
  elif command -v rocm-smi &>/dev/null && rocm-smi &>/dev/null; then
    echo "amd"
  else
    echo "cpu"
  fi
}

# ── Local: install system dependencies ───────────────────────────────────────

local_install_deps() {
  hdr "Installing system dependencies"

  log "Updating apt..."
  apt-get update -qq

  # Node.js 20
  if ! command -v node &>/dev/null || [[ "$(node --version | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
    log "Installing Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - -qq
    apt-get install -y -qq nodejs
    ok "Node.js $(node --version) installed"
  else
    ok "Node.js $(node --version) already installed"
  fi

  # MongoDB 7
  if ! command -v mongod &>/dev/null; then
    log "Installing MongoDB 7..."
    curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
      gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg
    echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] \
https://repo.mongodb.org/apt/ubuntu $(lsb_release -cs)/mongodb-org/7.0 multiverse" \
      > /etc/apt/sources.list.d/mongodb-org-7.0.list
    apt-get update -qq
    apt-get install -y -qq mongodb-org
    systemctl enable --now mongod
    ok "MongoDB 7 installed"
  else
    ok "MongoDB already installed: $(mongod --version 2>&1 | head -1)"
  fi

  # nginx
  if ! command -v nginx &>/dev/null; then
    log "Installing nginx..."
    apt-get install -y -qq nginx
    ok "nginx installed"
  else
    ok "nginx already installed"
  fi

  # Ollama
  if ! command -v ollama &>/dev/null; then
    log "Installing Ollama..."
    curl -fsSL https://ollama.ai/install.sh | sh
    ok "Ollama installed"
  else
    ok "Ollama already installed: $(ollama --version 2>&1)"
  fi

  # GPU setup
  GPU=$(detect_gpu)
  case "$GPU" in
    nvidia) ok "NVIDIA GPU detected — Ollama will use CUDA" ;;
    amd)    ok "AMD GPU detected — Ollama will use ROCm" ;;
    cpu)    warn "No GPU detected — Ollama will run on CPU (slower)" ;;
  esac

  # Start Ollama service
  if ! systemctl is-active --quiet ollama 2>/dev/null; then
    log "Starting Ollama service..."
    if [[ -f /etc/systemd/system/ollama.service ]]; then
      systemctl enable --now ollama
    else
      # Create service if installer didn't
      cat > /etc/systemd/system/ollama.service <<OLLAMASVC
[Unit]
Description=Ollama AI Service
After=network-online.target

[Service]
ExecStart=/usr/local/bin/ollama serve
Restart=always
RestartSec=3
Environment=OLLAMA_HOST=0.0.0.0

[Install]
WantedBy=multi-user.target
OLLAMASVC
      systemctl daemon-reload
      systemctl enable --now ollama
    fi
  fi
  ok "Ollama service running on port $LOCAL_OLLAMA_PORT"

  # Misc tools
  apt-get install -y -qq curl python3 git 2>/dev/null || true
}

# ── Local: configure MongoDB auth ─────────────────────────────────────────────

local_configure_mongo() {
  hdr "Configuring MongoDB"

  # Wait for mongod to be up
  local retries=15
  while ! mongosh --quiet --eval "db.adminCommand('ping')" &>/dev/null && [[ $retries -gt 0 ]]; do
    sleep 2; ((retries--))
  done
  [[ $retries -eq 0 ]] && err "MongoDB did not start in time"

  # Create admin user if not exists
  mongosh --quiet admin --eval "
    try {
      db.createUser({
        user: '$MONGO_USER',
        pwd: '$MONGO_PASS',
        roles: [{role:'root',db:'admin'}]
      });
      print('MongoDB admin user created');
    } catch(e) {
      print('User may already exist: ' + e.message);
    }
  " 2>/dev/null || true

  ok "MongoDB configured (user: $MONGO_USER, db: $MONGO_DB)"
}

# ── Local: generate self-signed cert ──────────────────────────────────────────

local_generate_cert() {
  local CERT_DIR="/etc/ssl/ollama-chat"
  local CERT_FILE="$CERT_DIR/cert.pem"
  local KEY_FILE="$CERT_DIR/key.pem"

  if [[ -f "$CERT_FILE" && -f "$KEY_FILE" ]]; then
    ok "TLS cert already exists at $CERT_DIR"
    return
  fi

  log "Generating self-signed TLS certificate..."
  mkdir -p "$CERT_DIR"
  command -v openssl &>/dev/null || apt-get install -y -qq openssl

  local LOCAL_IP HOSTNAME
  LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")
  HOSTNAME=$(hostname -f 2>/dev/null || hostname)

  openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
    -keyout "$KEY_FILE" \
    -out    "$CERT_FILE" \
    -subj "/CN=$HOSTNAME" \
    -addext "subjectAltName=DNS:$HOSTNAME,DNS:localhost,IP:$LOCAL_IP,IP:127.0.0.1" \
    2>/dev/null

  chmod 600 "$KEY_FILE"
  ok "Self-signed cert generated for $HOSTNAME / $LOCAL_IP (10-year validity)"
  warn "Browser will show 'unsafe' warning — click Advanced → Proceed to accept the self-signed cert."
  warn "This is required for voice input (SpeechRecognition requires HTTPS)."
}

# ── Local: write nginx config ─────────────────────────────────────────────────

local_configure_nginx() {
  hdr "Configuring nginx"

  local TLS_BLOCK=""
  local PORT_LINE="listen $LOCAL_WEB_PORT;"

  if [[ "$LOCAL_ENABLE_HTTPS" == "True" ]]; then
    local_generate_cert
    TLS_BLOCK="
server {
    listen $LOCAL_HTTPS_PORT ssl http2;
    server_name _;

    ssl_certificate     /etc/ssl/ollama-chat/cert.pem;
    ssl_certificate_key /etc/ssl/ollama-chat/key.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    root /var/www/ollama-chat;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:$LOCAL_BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 600s;
        proxy_buffering off;
        client_max_body_size 50m;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:$LOCAL_BACKEND_PORT;
    }
}
"
  fi

  cat > /etc/nginx/sites-available/ollama-chat <<NGINXCONF
server {
    $PORT_LINE
    server_name _;

    root /var/www/ollama-chat;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:$LOCAL_BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_cache_bypass \$http_upgrade;
        # Long timeout + no buffering so SSE streaming works
        proxy_read_timeout 600s;
        proxy_buffering off;
        client_max_body_size 50m;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:$LOCAL_BACKEND_PORT;
    }
}
$TLS_BLOCK
NGINXCONF

  ln -sf /etc/nginx/sites-available/ollama-chat /etc/nginx/sites-enabled/ollama-chat
  rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
  nginx -t && systemctl enable --now nginx && systemctl reload nginx
  ok "nginx configured on port $LOCAL_WEB_PORT (HTTP)"
  if [[ "$LOCAL_ENABLE_HTTPS" == "True" ]]; then
    ok "nginx HTTPS listener on port $LOCAL_HTTPS_PORT"
  fi
}

# ── Local: write backend systemd service ──────────────────────────────────────

local_write_backend_service() {
  hdr "Writing backend systemd service"

  # Build MONGO_URI without auth if password is empty (dev mode)
  local MONGO_URI="mongodb://$MONGO_USER:$MONGO_PASS@127.0.0.1:27017/$MONGO_DB?authSource=admin"

  cat > /etc/systemd/system/ollama-backend.service <<SVCONF
[Unit]
Description=Ollama Chat Backend
After=network.target mongod.service

[Service]
Type=simple
WorkingDirectory=$BACKEND_DIR
ExecStart=$(command -v node) server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=$LOCAL_BACKEND_PORT
Environment=OLLAMA_URL=http://127.0.0.1:$LOCAL_OLLAMA_PORT/api/chat
Environment=OLLAMA_BASE=http://127.0.0.1:$LOCAL_OLLAMA_PORT
Environment=MONGO_URI=$MONGO_URI
Environment=JWT_SECRET=$BACKEND_JWT
Environment=JWT_EXPIRY=$BACKEND_JWT_EXP
Environment=SMTP_HOST=$SMTP_HOST
Environment=SMTP_PORT=$SMTP_PORT
Environment=SMTP_USER=$SMTP_USER
Environment=SMTP_PASS=$SMTP_PASS
Environment=SMTP_FROM=$SMTP_FROM

[Install]
WantedBy=multi-user.target
SVCONF

  systemctl daemon-reload
  ok "Backend service written"
}

# ── Local: full setup ─────────────────────────────────────────────────────────

local_setup() {
  [[ "$(id -u)" -ne 0 ]] && err "Local setup must run as root (sudo ./run.sh setup)"

  ensure_strong_jwt
  log "Starting local install on $(hostname)"
  local_install_deps
  local_configure_mongo
  local_deploy_backend
  local_configure_nginx
  local_deploy_frontend
  sleep 3
  local_sync_users

  hdr "Setup complete"
  local LOCAL_IP
  LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")
  ok "Web UI (HTTP):  http://$LOCAL_IP:$LOCAL_WEB_PORT"
  if [[ "$LOCAL_ENABLE_HTTPS" == "True" ]]; then
    ok "Web UI (HTTPS): https://$LOCAL_IP:$LOCAL_HTTPS_PORT  ← use this for voice input"
  fi
  ok "Backend:        http://127.0.0.1:$LOCAL_BACKEND_PORT"
  ok "Ollama:         http://127.0.0.1:$LOCAL_OLLAMA_PORT"
  ok "MongoDB:        mongodb://127.0.0.1:27017/$MONGO_DB"
  ok "API Docs:       http://$LOCAL_IP:$LOCAL_WEB_PORT/api/docs.json"
}

# ── Local: deploy backend ─────────────────────────────────────────────────────

local_deploy_backend() {
  hdr "Deploying backend"
  log "Installing npm dependencies..."
  (cd "$BACKEND_DIR" && npm install --production --silent)
  local_write_backend_service
  systemctl enable ollama-backend
  systemctl restart ollama-backend
  # Wait for it to be up
  local retries=20
  while ! curl -sf "http://127.0.0.1:$LOCAL_BACKEND_PORT/health" &>/dev/null && [[ $retries -gt 0 ]]; do
    sleep 2; ((retries--))
  done
  if curl -sf "http://127.0.0.1:$LOCAL_BACKEND_PORT/health" &>/dev/null; then
    ok "Backend running at http://127.0.0.1:$LOCAL_BACKEND_PORT"
  else
    warn "Backend may still be starting — check: journalctl -u ollama-backend -f"
  fi
}

# ── Local: deploy frontend ────────────────────────────────────────────────────

local_deploy_frontend() {
  hdr "Building and deploying frontend"
  log "Installing npm dependencies..."
  (cd "$FRONTEND_DIR" && npm install --silent)
  log "Building React app..."
  (cd "$FRONTEND_DIR" && npm run build)
  mkdir -p /var/www/ollama-chat
  rm -rf /var/www/ollama-chat/*
  cp -r "$FRONTEND_DIR/build/." /var/www/ollama-chat/
  systemctl reload nginx 2>/dev/null || true
  ok "Frontend deployed to /var/www/ollama-chat"
}

# ── Local: sync models ────────────────────────────────────────────────────────

local_sync_models() {
  hdr "Syncing Ollama models"
  local MODELS
  MODELS=$(python3 -c "
import json
d = json.load(open('$CONFIG'))
for m in d['ollama']['models']:
    print(m)
")

  # Wait for Ollama to be ready
  local retries=15
  while ! curl -sf "http://127.0.0.1:$LOCAL_OLLAMA_PORT/api/tags" &>/dev/null && [[ $retries -gt 0 ]]; do
    sleep 3; ((retries--))
  done

  for MODEL in $MODELS; do
    INSTALLED=$(curl -s "http://127.0.0.1:$LOCAL_OLLAMA_PORT/api/tags" | \
      python3 -c "import json,sys; models=[m['name'] for m in json.load(sys.stdin).get('models',[])]; print('1' if any(m.startswith('$MODEL') for m in models) else '0')" 2>/dev/null || echo "0")
    if [[ "$INSTALLED" == "0" ]]; then
      log "Pulling $MODEL..."
      ollama pull "$MODEL" &
    else
      ok "$MODEL already present"
    fi
  done
  wait
  ok "Model sync complete"
}

# ── Local: status ─────────────────────────────────────────────────────────────

local_status() {
  hdr "Local Service Status"

  # GPU
  GPU=$(detect_gpu)
  echo "  GPU: $GPU"
  echo ""

  # Services
  for svc in ollama ollama-backend nginx mongod; do
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
      ok "  $svc — active"
    else
      warn "  $svc — inactive"
    fi
  done
  echo ""

  # Ollama models
  hdr "Installed Models"
  curl -s "http://127.0.0.1:$LOCAL_OLLAMA_PORT/api/tags" 2>/dev/null | \
    python3 -c "
import json,sys
data = json.load(sys.stdin)
models = data.get('models', [])
if models:
    for m in models:
        size = round(m.get('size',0)/1e9, 1)
        print(f'  {m[\"name\"]:40s} {size} GB')
else:
    print('  (no models installed)')
" 2>/dev/null || warn "Ollama not reachable"
  echo ""

  # Health
  hdr "Backend Health"
  curl -s "http://127.0.0.1:$LOCAL_BACKEND_PORT/health" 2>/dev/null | \
    python3 -c "
import json,sys
d = json.load(sys.stdin)
print(f'  status:  {d.get(\"status\",\"?\")}')
print(f'  mongodb: {d.get(\"mongo\",\"?\")}')
print(f'  ollama:  {d.get(\"ollama\",\"?\")}')
" 2>/dev/null || warn "Backend not reachable at http://127.0.0.1:$LOCAL_BACKEND_PORT/health"
}

# ── Local: logs ───────────────────────────────────────────────────────────────

local_logs() {
  local svc="${1:-ollama-backend}"
  log "Tailing $svc logs (Ctrl+C to stop)..."
  journalctl -u "$svc" -f --no-hostname --output=short-iso
}

# ── Local: restart ────────────────────────────────────────────────────────────

local_restart() {
  local target="${1:-all}"
  if [[ "$target" == "all" || "$target" == "backend" ]]; then
    systemctl restart ollama-backend && ok "Backend restarted"
  fi
  if [[ "$target" == "all" || "$target" == "nginx" ]]; then
    systemctl reload nginx && ok "nginx reloaded"
  fi
  if [[ "$target" == "all" || "$target" == "ollama" ]]; then
    systemctl restart ollama && ok "Ollama restarted"
  fi
}

# ── Local: sync users ─────────────────────────────────────────────────────────

local_sync_users() {
  log "Syncing users from config.json..."
  local USERS
  USERS=$(python3 -c "
import json
d = json.load(open('$CONFIG'))
for u in d['users']:
    print(u['username'], u['password'], u.get('role','user'), u.get('email',''))
")
  local TOKEN
  TOKEN=$(local_get_admin_token)
  while IFS=' ' read -r username password role email; do
    [[ -z "$username" ]] && continue
    RESULT=$(curl -s -X POST "http://127.0.0.1:$LOCAL_BACKEND_PORT/api/admin/users" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d "{\"username\":\"$username\",\"password\":\"$password\",\"role\":\"$role\",\"email\":\"$email\"}" 2>/dev/null)
    if echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); exit(0 if 'id' in d or 'already' in d.get('error','') else 1)" 2>/dev/null; then
      ok "User '$username' ($role) ready"
    else
      warn "User '$username': $RESULT"
    fi
  done <<< "$USERS"
}

local_get_admin_token() {
  local ADMIN_CREDS ADMIN_USER ADMIN_PASS TOKEN
  ADMIN_CREDS=$(python3 -c "
import json
d = json.load(open('$CONFIG'))
for u in d['users']:
    if u.get('role') == 'admin':
        print(u['username'], u['password'])
        break
")
  ADMIN_USER=$(echo "$ADMIN_CREDS" | awk '{print $1}')
  ADMIN_PASS=$(echo "$ADMIN_CREDS" | awk '{print $2}')
  TOKEN=$(curl -s -X POST "http://127.0.0.1:$LOCAL_BACKEND_PORT/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" 2>/dev/null | \
    python3 -c "import json,sys; print(json.load(sys.stdin)['token'])" 2>/dev/null || echo "")
  if [[ -z "$TOKEN" ]]; then
    TOKEN=$(local_bootstrap_admin "$ADMIN_USER" "$ADMIN_PASS")
  fi
  echo "$TOKEN"
}

local_bootstrap_admin() {
  local user="$1" pass="$2"
  # Insert admin directly via mongosh (first-time setup when DB is empty)
  local HASH
  HASH=$(python3 -c "
import subprocess, sys
try:
    import bcrypt
    h = bcrypt.hashpw('$pass'.encode(), bcrypt.gensalt(12)).decode()
    print(h)
except ImportError:
    r = subprocess.run(['node','-e',
        \"const b=require('bcryptjs');b.hash('$pass',12).then(h=>process.stdout.write(h))\"],
        capture_output=True, text=True, cwd='$BACKEND_DIR')
    print(r.stdout.strip())
" 2>/dev/null || echo "")

  if [[ -n "$HASH" ]]; then
    mongosh --quiet "$MONGO_DB" \
      -u "$MONGO_USER" -p "$MONGO_PASS" --authenticationDatabase admin \
      --eval "
db.users.updateOne(
  {username: '$user'},
  {\$setOnInsert: {username:'$user', passwordHash:'$HASH', role:'admin', createdAt: new Date()}},
  {upsert: true}
);" 2>/dev/null || true
  fi

  # Retry login
  curl -s -X POST "http://127.0.0.1:$LOCAL_BACKEND_PORT/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$user\",\"password\":\"$pass\"}" 2>/dev/null | \
    python3 -c "import json,sys; print(json.load(sys.stdin)['token'])" 2>/dev/null || echo ""
}

local_add_user() {
  local target_user="${1:-}"
  [[ -z "$target_user" ]] && { echo "Usage: ./run.sh add-user <username>"; exit 1; }
  local USER_DATA
  USER_DATA=$(python3 -c "
import json
d = json.load(open('$CONFIG'))
for u in d['users']:
    if u['username'] == '$target_user':
        print(u['username'], u['password'], u.get('role','user'), u.get('email',''))
        break
")
  [[ -z "$USER_DATA" ]] && err "User '$target_user' not found in config.json"
  local username password role email
  read -r username password role email <<< "$USER_DATA"
  local TOKEN; TOKEN=$(local_get_admin_token)
  RESULT=$(curl -s -X POST "http://127.0.0.1:$LOCAL_BACKEND_PORT/api/admin/users" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"username\":\"$username\",\"password\":\"$password\",\"role\":\"$role\",\"email\":\"$email\"}")
  echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print('Created:', d.get('username',''), d.get('role',''), '|', d.get('error',''))" 2>/dev/null
  ok "Done"
}

local_remove_user() {
  local target_user="${1:-}"
  [[ -z "$target_user" ]] && { echo "Usage: ./run.sh remove-user <username>"; exit 1; }
  local TOKEN; TOKEN=$(local_get_admin_token)
  USER_ID=$(curl -s "http://127.0.0.1:$LOCAL_BACKEND_PORT/api/admin/users" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null | \
    python3 -c "import json,sys; users=json.load(sys.stdin); print(next((u['_id'] for u in users if u['username']=='$target_user'),''))" 2>/dev/null)
  [[ -z "$USER_ID" ]] && err "User '$target_user' not found in the database"
  curl -s -X DELETE "http://127.0.0.1:$LOCAL_BACKEND_PORT/api/admin/users/$USER_ID" \
    -H "Authorization: Bearer $TOKEN" >/dev/null
  ok "User '$target_user' removed"
}

local_uninstall() {
  warn "This will remove nginx config, backend service, and frontend files."
  warn "MongoDB data and Ollama models will NOT be deleted."
  read -rp "Type 'yes' to confirm: " confirm
  [[ "$confirm" == "yes" ]] || { echo "Aborted."; exit 0; }

  systemctl stop ollama-backend 2>/dev/null || true
  systemctl disable ollama-backend 2>/dev/null || true
  rm -f /etc/systemd/system/ollama-backend.service
  systemctl daemon-reload

  rm -f /etc/nginx/sites-enabled/ollama-chat
  rm -f /etc/nginx/sites-available/ollama-chat
  systemctl reload nginx 2>/dev/null || true

  rm -rf /var/www/ollama-chat

  rm -f "$MODE_FILE"

  ok "Local deployment removed"
  warn "To also remove MongoDB: sudo apt-get purge mongodb-org*"
  warn "To also remove Ollama:  sudo systemctl stop ollama && sudo rm /usr/local/bin/ollama"
}

# ─────────────────────────────────────────────────────────────────────────────
#  CLUSTER MODE  (K3s)
# ─────────────────────────────────────────────────────────────────────────────

cluster_check_deps() {
  for cmd in sshpass python3 npm node tar docker; do
    command -v "$cmd" >/dev/null 2>&1 || err "Required tool '$cmd' not found. Install it first."
  done
}

remote_master() { $SSH "$SSH_USER@$MASTER_IP" "$@"; }
remote_worker() { $SSH "$SSH_USER@$WORKER_IP" "$@"; }

OLLAMA_MANIFEST=$(cat <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ollama
  labels:
    app: ollama
spec:
  replicas: $OLLAMA_REPLICAS
  selector:
    matchLabels:
      app: ollama
  template:
    metadata:
      labels:
        app: ollama
    spec:
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              topologyKey: kubernetes.io/hostname
              labelSelector:
                matchLabels:
                  app: ollama
      containers:
      - name: ollama
        image: ollama/ollama:latest
        ports:
        - containerPort: 11434
        resources:
          limits:
            cpu: "$OLLAMA_CPU"
            memory: $OLLAMA_MEM
        volumeMounts:
        - name: ollama-data
          mountPath: /root/.ollama
      volumes:
      - name: ollama-data
        hostPath:
          path: /var/lib/ollama-data
          type: DirectoryOrCreate
---
apiVersion: v1
kind: Service
metadata:
  name: ollama-service
spec:
  type: NodePort
  selector:
    app: ollama
  ports:
  - port: 11434
    targetPort: 11434
    nodePort: $OLLAMA_NODEPORT
EOF
)

MONGO_MANIFEST=$(cat <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mongodb
  labels:
    app: mongodb
spec:
  replicas: 1
  selector:
    matchLabels:
      app: mongodb
  template:
    metadata:
      labels:
        app: mongodb
    spec:
      # Pin to master so hostPath data survives pod rescheduling
      nodeSelector:
        kubernetes.io/hostname: $MASTER_HOSTNAME
      containers:
      - name: mongodb
        image: mongo:7
        ports:
        - containerPort: 27017
        env:
        - name: MONGO_INITDB_ROOT_USERNAME
          value: "$MONGO_USER"
        - name: MONGO_INITDB_ROOT_PASSWORD
          value: "$MONGO_PASS"
        - name: MONGO_INITDB_DATABASE
          value: "$MONGO_DB"
        resources:
          limits:
            cpu: "2"
            memory: "2Gi"
        volumeMounts:
        - name: mongo-data
          mountPath: /data/db
      volumes:
      - name: mongo-data
        hostPath:
          path: /var/lib/ollama-mongo-data
          type: DirectoryOrCreate
---
apiVersion: v1
kind: Service
metadata:
  name: mongodb
spec:
  type: NodePort
  selector:
    app: mongodb
  ports:
  - port: 27017
    targetPort: 27017
    nodePort: $MONGO_NODEPORT
EOF
)

APP_MANIFEST=$(cat <<APPEOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ollama-frontend
  labels:
    app: ollama-frontend
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ollama-frontend
  template:
    metadata:
      labels:
        app: ollama-frontend
    spec:
      containers:
      - name: frontend
        image: docker.io/library/ollama-frontend:latest
        imagePullPolicy: Never
        ports:
        - containerPort: 3000
        resources:
          limits:
            cpu: "500m"
            memory: "128Mi"
---
apiVersion: v1
kind: Service
metadata:
  name: ollama-frontend-svc
spec:
  type: NodePort
  selector:
    app: ollama-frontend
  ports:
  - port: 3000
    targetPort: 3000
    nodePort: 30080
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ollama-backend
  labels:
    app: ollama-backend
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ollama-backend
  template:
    metadata:
      labels:
        app: ollama-backend
    spec:
      serviceAccountName: default
      containers:
      - name: backend
        image: docker.io/library/ollama-backend:latest
        imagePullPolicy: Never
        ports:
        - containerPort: 5000
        env:
        - name: PORT
          value: "5000"
        - name: OLLAMA_URL
          value: "http://ollama-service.default.svc.cluster.local:11434/api/chat"
        - name: OLLAMA_BASE
          value: "http://ollama-service.default.svc.cluster.local:11434"
        - name: MONGO_URI
          value: "mongodb://$MONGO_USER:$MONGO_PASS@mongodb.default.svc.cluster.local:27017/$MONGO_DB?authSource=admin"
        - name: JWT_SECRET
          value: "$BACKEND_JWT"
        - name: JWT_EXPIRY
          value: "$BACKEND_JWT_EXP"
        - name: SMTP_HOST
          value: "$SMTP_HOST"
        - name: SMTP_PORT
          value: "$SMTP_PORT"
        - name: SMTP_USER
          value: "$SMTP_USER"
        - name: SMTP_PASS
          value: "$SMTP_PASS"
        - name: SMTP_FROM
          value: "$SMTP_FROM"
        resources:
          limits:
            cpu: "1"
            memory: "512Mi"
---
apiVersion: v1
kind: Service
metadata:
  name: ollama-backend-svc
spec:
  type: NodePort
  selector:
    app: ollama-backend
  ports:
  - port: 5000
    targetPort: 5000
    nodePort: 30500
APPEOF
)

RBAC_MANIFEST=$(cat <<RBACEOF
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: ollama-backend-role
rules:
- apiGroups: [""]
  resources: ["nodes","pods","services"]
  verbs: ["get","list"]
- apiGroups: ["metrics.k8s.io"]
  resources: ["nodes","pods"]
  verbs: ["get","list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: ollama-backend-binding
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: ollama-backend-role
subjects:
- kind: ServiceAccount
  name: default
  namespace: default
RBACEOF
)

cluster_build_and_push_image() {
  local name="$1" dir="$2"
  log "Building $name image..."
  docker build -t "$name:latest" "$dir" --quiet
  docker save "$name:latest" -o "/tmp/${name}.tar"
  # Push to master
  $SCP "/tmp/${name}.tar" "$SSH_USER@$MASTER_IP:/tmp/"
  remote_master "k3s ctr images import /tmp/${name}.tar"
  # Push to worker so pods can schedule there too
  $SCP "/tmp/${name}.tar" "$SSH_USER@$WORKER_IP:/tmp/"
  remote_worker "k3s ctr images import /tmp/${name}.tar"
  rm -f "/tmp/${name}.tar"
  ok "$name image imported on both nodes"
}

cluster_setup() {
  cluster_check_deps
  ensure_strong_jwt
  log "Setting up Ollama Cluster on $MASTER_IP + $WORKER_IP"

  log "Creating persistent storage directories on both nodes..."
  remote_master "mkdir -p /var/lib/ollama-data /var/lib/ollama-mongo-data"
  $SSH "$SSH_USER@$WORKER_IP" "mkdir -p /var/lib/ollama-data" || true
  ok "Persistent dirs ready (Ollama models + MongoDB data survive pod restarts)"

  log "Installing K3s on master ($MASTER_IP)..."
  remote_master "curl -sfL https://get.k3s.io | K3S_TOKEN=$K3S_TOKEN sh -" || true
  sleep 10
  remote_master "k3s kubectl get nodes" || warn "K3s may already be running"
  ok "K3s master ready"

  log "Installing K3s agent on worker ($WORKER_IP)..."
  $SSH "$SSH_USER@$WORKER_IP" "curl -sfL https://get.k3s.io | K3S_URL=https://$MASTER_IP:6443 K3S_TOKEN=$K3S_TOKEN sh -" || true
  sleep 15
  remote_master "k3s kubectl wait --for=condition=Ready node --all --timeout=120s" || warn "Worker may take more time to join"
  ok "Worker joined cluster"

  # RBAC for backend pod
  echo "$RBAC_MANIFEST" | remote_master "cat > /tmp/rbac.yaml && k3s kubectl apply -f /tmp/rbac.yaml"
  ok "RBAC configured"

  if [[ "$MONGO_ENABLED" == "True" ]]; then
    log "Deploying MongoDB..."
    echo "$MONGO_MANIFEST" | remote_master "cat > /tmp/mongodb.yaml && k3s kubectl apply -f /tmp/mongodb.yaml"
    remote_master "k3s kubectl wait --for=condition=Ready pod -l app=mongodb --timeout=120s" || warn "MongoDB pod taking time..."
    ok "MongoDB deployed on NodePort $MONGO_NODEPORT"
  fi

  log "Deploying Ollama ($OLLAMA_REPLICAS replicas)..."
  echo "$OLLAMA_MANIFEST" | remote_master "cat > /tmp/ollama.yaml && k3s kubectl apply -f /tmp/ollama.yaml"
  remote_master "k3s kubectl wait --for=condition=Ready pod -l app=ollama --timeout=180s" || warn "Ollama pods taking time..."
  ok "Ollama deployed on NodePort $OLLAMA_NODEPORT"

  cluster_sync_models
  cluster_deploy_backend
  cluster_deploy_frontend
  sleep 5
  cluster_sync_users

  hdr "Cluster setup complete"
  ok "Web UI:   http://$MASTER_IP:30080"
  ok "Backend:  http://$MASTER_IP:30500"
  ok "Ollama:   http://$MASTER_IP:$OLLAMA_NODEPORT"
  ok "MongoDB:  $MASTER_IP:$MONGO_NODEPORT  (internal)"
}

cluster_uninstall() {
  warn "This will remove K3s, all pods, and all data."
  read -rp "Type 'yes' to confirm: " confirm
  [[ "$confirm" == "yes" ]] || { echo "Aborted."; exit 0; }

  remote_master "k3s-uninstall.sh 2>/dev/null || true"
  $SSH "$SSH_USER@$WORKER_IP" "k3s-agent-uninstall.sh 2>/dev/null || true"
  remote_master "pkill -f 'node server.js' 2>/dev/null || true"
  remote_master "rm -rf /var/www/html/* && systemctl restart nginx 2>/dev/null || true"
  rm -f "$MODE_FILE"
  ok "Cluster uninstall complete"
}

cluster_status() {
  hdr "Cluster Status"
  remote_master "k3s kubectl get nodes -o wide" 2>/dev/null || warn "K3s not running on master"
  echo ""
  remote_master "k3s kubectl get pods -A" 2>/dev/null || true
  echo ""
  hdr "Models on cluster"
  curl -s "http://$MASTER_IP:$OLLAMA_NODEPORT/api/tags" 2>/dev/null | \
    python3 -c "import json,sys; [print(f'  {m[\"name\"]}') for m in json.load(sys.stdin).get('models',[])]" \
    || warn "Ollama not reachable"
  echo ""
  hdr "Backend Health"
  curl -s "http://$MASTER_IP:30080/health" 2>/dev/null | \
    python3 -c "import json,sys; d=json.load(sys.stdin); print(f'  status: {d[\"status\"]}, mongo: {d[\"mongo\"]}, ollama: {d[\"ollama\"]}')" \
    || warn "Backend not reachable at http://$MASTER_IP:30080/health"
}

cluster_sync_models() {
  hdr "Syncing cluster models"
  MODELS=$(python3 -c "
import json
d = json.load(open('$CONFIG'))
for m in d['ollama']['models']:
    print(m)
")
  PODS=$(remote_master "k3s kubectl get pods -l app=ollama -o jsonpath='{.items[*].metadata.name}'" 2>/dev/null || echo "")
  for MODEL in $MODELS; do
    for POD in $PODS; do
      INSTALLED=$(remote_master "k3s kubectl exec $POD -- ollama list 2>/dev/null | grep -c '^$MODEL'" 2>/dev/null || echo "0")
      if [[ "$INSTALLED" == "0" ]]; then
        log "  Pulling $MODEL on $POD..."
        remote_master "k3s kubectl exec $POD -- ollama pull $MODEL" 2>/dev/null &
      else
        ok "  $MODEL already on $POD"
      fi
    done
  done
  wait
  ok "Model sync complete"
}

cluster_deploy_backend() {
  hdr "Deploying backend pod"
  (cd "$BACKEND_DIR" && npm install --production --silent)
  cluster_build_and_push_image "ollama-backend" "$BACKEND_DIR"
  echo "$APP_MANIFEST" | remote_master "cat > /tmp/app.yaml && k3s kubectl apply -f /tmp/app.yaml"
  remote_master "k3s kubectl rollout restart deployment/ollama-backend"
  remote_master "k3s kubectl wait --for=condition=Ready pod -l app=ollama-backend --timeout=60s"
  sleep 3
  curl -sf "http://$MASTER_IP:30500/health" && ok "Backend running" || warn "Health check failed — check pod logs"
}

cluster_deploy_frontend() {
  hdr "Deploying frontend pod"
  (cd "$FRONTEND_DIR" && npm install --silent && npm run build)
  cluster_build_and_push_image "ollama-frontend" "$FRONTEND_DIR"
  echo "$APP_MANIFEST" | remote_master "cat > /tmp/app.yaml && k3s kubectl apply -f /tmp/app.yaml"
  remote_master "k3s kubectl rollout restart deployment/ollama-frontend"
  remote_master "k3s kubectl wait --for=condition=Ready pod -l app=ollama-frontend --timeout=60s"
  ok "Frontend deployed at http://$MASTER_IP:30080"
}

cluster_get_admin_token() {
  local ADMIN_CREDS ADMIN_USER ADMIN_PASS
  ADMIN_CREDS=$(python3 -c "
import json
d = json.load(open('$CONFIG'))
for u in d['users']:
    if u.get('role') == 'admin':
        print(u['username'], u['password'])
        break
")
  ADMIN_USER=$(echo "$ADMIN_CREDS" | awk '{print $1}')
  ADMIN_PASS=$(echo "$ADMIN_CREDS" | awk '{print $2}')
  TOKEN=$(curl -s -X POST "http://$MASTER_IP:30080/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" 2>/dev/null | \
    python3 -c "import json,sys; print(json.load(sys.stdin)['token'])" 2>/dev/null || echo "")
  if [[ -z "$TOKEN" ]]; then
    TOKEN=$(cluster_bootstrap_admin "$ADMIN_USER" "$ADMIN_PASS")
  fi
  echo "$TOKEN"
}

cluster_bootstrap_admin() {
  local user="$1" pass="$2"
  local HASH
  HASH=$(node -e "const b=require('bcryptjs');b.hash('$pass',12).then(h=>process.stdout.write(h))" \
    2>/dev/null || echo "")
  if [[ -n "$HASH" ]]; then
    remote_master "k3s kubectl exec deploy/mongodb -- mongosh '$MONGO_DB' \
      -u '$MONGO_USER' -p '$MONGO_PASS' --authenticationDatabase admin \
      --eval \"db.users.updateOne({username:'$user'},{\\\$setOnInsert:{username:'$user',passwordHash:'$HASH',role:'admin',createdAt:new Date()}},{upsert:true})\"" 2>/dev/null || true
  fi
  curl -s -X POST "http://$MASTER_IP:30080/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$user\",\"password\":\"$pass\"}" 2>/dev/null | \
    python3 -c "import json,sys; print(json.load(sys.stdin)['token'])" 2>/dev/null || echo ""
}

cluster_sync_users() {
  log "Syncing users from config.json..."
  local USERS TOKEN
  USERS=$(python3 -c "
import json
d = json.load(open('$CONFIG'))
for u in d['users']:
    print(u['username'], u['password'], u.get('role','user'), u.get('email',''))
")
  TOKEN=$(cluster_get_admin_token)
  while IFS=' ' read -r username password role email; do
    [[ -z "$username" ]] && continue
    RESULT=$(curl -s -X POST "http://$MASTER_IP:30080/api/admin/users" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d "{\"username\":\"$username\",\"password\":\"$password\",\"role\":\"$role\",\"email\":\"$email\"}" 2>/dev/null)
    if echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); exit(0 if 'id' in d or 'already' in d.get('error','') else 1)" 2>/dev/null; then
      ok "User '$username' ($role) ready"
    else
      warn "User '$username': $RESULT"
    fi
  done <<< "$USERS"
}

cluster_add_user() {
  local target_user="${1:-}"
  [[ -z "$target_user" ]] && { echo "Usage: ./run.sh add-user <username>"; exit 1; }
  local USER_DATA
  USER_DATA=$(python3 -c "
import json
d = json.load(open('$CONFIG'))
for u in d['users']:
    if u['username'] == '$target_user':
        print(u['username'], u['password'], u.get('role','user'), u.get('email',''))
        break
")
  [[ -z "$USER_DATA" ]] && err "User '$target_user' not found in config.json"
  local username password role email
  read -r username password role email <<< "$USER_DATA"
  local TOKEN; TOKEN=$(cluster_get_admin_token)
  RESULT=$(curl -s -X POST "http://$MASTER_IP:30080/api/admin/users" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"username\":\"$username\",\"password\":\"$password\",\"role\":\"$role\",\"email\":\"$email\"}")
  echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print('Created:', d.get('username',''), d.get('role',''), '|', d.get('error',''))" 2>/dev/null
  ok "Done"
}

cluster_remove_user() {
  local target_user="${1:-}"
  [[ -z "$target_user" ]] && { echo "Usage: ./run.sh remove-user <username>"; exit 1; }
  local TOKEN; TOKEN=$(cluster_get_admin_token)
  USER_ID=$(curl -s "http://$MASTER_IP:30080/api/admin/users" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null | \
    python3 -c "import json,sys; users=json.load(sys.stdin); print(next((u['_id'] for u in users if u['username']=='$target_user'),''))" 2>/dev/null)
  [[ -z "$USER_ID" ]] && err "User '$target_user' not found in the database"
  curl -s -X DELETE "http://$MASTER_IP:30080/api/admin/users/$USER_ID" \
    -H "Authorization: Bearer $TOKEN" >/dev/null
  ok "User '$target_user' removed"
}

cluster_logs() {
  log "Backend pod logs (Ctrl+C to stop)..."
  remote_master "k3s kubectl logs -l app=ollama-backend -f --tail=100"
}

# ─────────────────────────────────────────────────────────────────────────────
#  Entry point — route by mode
# ─────────────────────────────────────────────────────────────────────────────

COMMAND="${1:-help}"
shift || true

show_help() {
  echo ""
  echo "  Ollama Chat Manager"
  echo ""
  echo "  Usage: ./run.sh [--local|--cluster] <command> [args]"
  echo ""
  echo "  Mode flags (override saved .run-mode):"
  echo "    --local     Force local mode"
  echo "    --cluster   Force cluster mode"
  echo "    (no flag)   Use saved mode or prompt on first run"
  echo ""
  echo "  Commands (work in both modes unless noted):"
  echo "    setup              Full install and start everything"
  echo "    uninstall          Remove deployment (asks confirmation)"
  echo "    status             Show service/model/health status"
  echo "    sync-models        Pull models from config.json"
  echo "    sync-users         Create/update all users from config.json"
  echo "    add-user <name>    Add a user from config.json"
  echo "    remove-user <name> Delete a user"
  echo "    deploy-backend     Reinstall deps and restart backend"
  echo "    deploy-frontend    Rebuild React app and deploy"
  echo "    logs [svc]         Tail logs (local: pass service name, default=ollama-backend)"
  echo "    restart [target]   Restart services — local only (all/backend/nginx/ollama)"
  echo ""
  echo "  Current mode: $MODE  (saved in .run-mode)"
  echo ""
}

case "$COMMAND" in
  setup)
    [[ "$MODE" == "local" ]]   && local_setup   || cluster_setup ;;
  uninstall)
    [[ "$MODE" == "local" ]]   && local_uninstall   || cluster_uninstall ;;
  status)
    [[ "$MODE" == "local" ]]   && local_status   || cluster_status ;;
  sync-models)
    [[ "$MODE" == "local" ]]   && local_sync_models   || cluster_sync_models ;;
  sync-users)
    [[ "$MODE" == "local" ]]   && local_sync_users   || cluster_sync_users ;;
  add-user)
    [[ "$MODE" == "local" ]]   && local_add_user "${1:-}"   || cluster_add_user "${1:-}" ;;
  remove-user)
    [[ "$MODE" == "local" ]]   && local_remove_user "${1:-}"   || cluster_remove_user "${1:-}" ;;
  deploy-backend)
    [[ "$MODE" == "local" ]]   && local_deploy_backend   || cluster_deploy_backend ;;
  deploy-frontend)
    [[ "$MODE" == "local" ]]   && local_deploy_frontend   || cluster_deploy_frontend ;;
  logs)
    [[ "$MODE" == "local" ]]   && local_logs "${1:-ollama-backend}"   || cluster_logs ;;
  restart)
    if [[ "$MODE" == "local" ]]; then
      local_restart "${1:-all}"
    else
      warn "restart is for local mode. For cluster use: deploy-backend / deploy-frontend"
    fi ;;
  help|--help|-h)
    show_help ;;
  *)
    echo "Unknown command: $COMMAND. Run './run.sh help' for usage."
    exit 1 ;;
esac
