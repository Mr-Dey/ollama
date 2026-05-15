#!/usr/bin/env bash
# run.sh — Ollama Cluster management script
# Usage: ./run.sh <command> [args]
#
# Commands:
#   setup             Install K3s, MongoDB, Ollama, backend, frontend
#   uninstall         Remove everything from all nodes
#   status            Show cluster, models, and user status
#   sync-models       Pull models in config; remove models not in config
#   sync-users        Create all users from config.json into MongoDB
#   add-user <name>   Add a specific user from config.json to MongoDB
#   remove-user <name> Remove a user from MongoDB (and their conversations)
#   deploy-backend    Reinstall deps and restart backend
#   deploy-frontend   Rebuild React app and deploy to nginx
#   logs              Tail backend logs

set -euo pipefail

# ─── Load config ────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$SCRIPT_DIR/config.json"

if [[ ! -f "$CONFIG" ]]; then
  echo "ERROR: config.json not found at $CONFIG"
  exit 1
fi

_cfg() {
  python3 -c "import json,sys; d=json.load(open('$CONFIG')); print(d$1)" 2>/dev/null || echo ""
}

MASTER_IP=$(_cfg "['cluster']['master']['ip']")
WORKER_IP=$(_cfg "['cluster']['worker']['ip']")
SSH_USER=$(_cfg "['cluster']['ssh']['user']")
SSH_PASS=$(_cfg "['cluster']['ssh']['password']")
K3S_TOKEN=$(_cfg "['cluster']['k3s']['token']")

OLLAMA_REPLICAS=$(_cfg "['ollama']['replicas']")
OLLAMA_NODEPORT=$(_cfg "['ollama']['nodeport']")
OLLAMA_CPU=$(_cfg "['ollama']['cpu_limit']")
OLLAMA_MEM=$(_cfg "['ollama']['memory_limit']")

MONGO_ENABLED=$(_cfg "['mongodb']['enabled']")
MONGO_NODEPORT=$(_cfg "['mongodb']['nodeport']")
MONGO_DB=$(_cfg "['mongodb']['database']")
MONGO_USER=$(_cfg "['mongodb']['username']")
MONGO_PASS=$(_cfg "['mongodb']['password']")

BACKEND_PORT=$(_cfg "['backend']['port']")
BACKEND_JWT=$(_cfg "['backend']['jwt_secret']")
BACKEND_JWT_EXP=$(_cfg "['backend']['jwt_expiry']")

FRONTEND_PORT=$(_cfg "['frontend']['port']")

SSH="sshpass -p $SSH_PASS ssh -o StrictHostKeyChecking=no $SSH_USER"
SCP="sshpass -p $SSH_PASS scp -o StrictHostKeyChecking=no"

BACKEND_DIR="$SCRIPT_DIR/chat-app/backend"
FRONTEND_DIR="$SCRIPT_DIR/chat-app/frontend"

# ─── Helpers ─────────────────────────────────────────────────────────────────

log()  { echo -e "\033[1;36m▶ $*\033[0m"; }
ok()   { echo -e "\033[1;32m✓ $*\033[0m"; }
warn() { echo -e "\033[1;33m⚠ $*\033[0m"; }
err()  { echo -e "\033[1;31m✗ $*\033[0m"; exit 1; }

check_deps() {
  for cmd in sshpass python3 npm node tar; do
    command -v "$cmd" >/dev/null 2>&1 || err "Required tool '$cmd' not found. Install it first."
  done
}

remote_master() { $SSH $MASTER_IP "$@"; }
remote_worker() { $SSH $WORKER_IP "$@"; }

# ─── K8s Manifests (inline) ──────────────────────────────────────────────────

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
        emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: ollama-svc
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
        emptyDir: {}
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

# ─── Commands ─────────────────────────────────────────────────────────────────

cmd_setup() {
  check_deps
  log "Setting up Ollama Cluster on $MASTER_IP + $WORKER_IP"

  # ── 1. Install K3s on master ──
  log "Installing K3s on master ($MASTER_IP)..."
  remote_master "curl -sfL https://get.k3s.io | K3S_TOKEN=$K3S_TOKEN sh -" || true
  sleep 10
  remote_master "k3s kubectl get nodes" || warn "K3s may already be running"
  ok "K3s master ready"

  # ── 2. Install K3s agent on worker ──
  log "Installing K3s agent on worker ($WORKER_IP)..."
  $SSH $WORKER_IP "curl -sfL https://get.k3s.io | K3S_URL=https://$MASTER_IP:6443 K3S_TOKEN=$K3S_TOKEN sh -" || true
  sleep 15
  remote_master "k3s kubectl wait --for=condition=Ready node --all --timeout=120s" || warn "Worker may take more time to join"
  ok "Worker joined cluster"

  # ── 3. Deploy MongoDB ──
  if [[ "$MONGO_ENABLED" == "True" ]]; then
    log "Deploying MongoDB..."
    echo "$MONGO_MANIFEST" | remote_master "cat > /tmp/mongodb.yaml && k3s kubectl apply -f /tmp/mongodb.yaml"
    remote_master "k3s kubectl wait --for=condition=Ready pod -l app=mongodb --timeout=120s" || warn "MongoDB pod taking time..."
    ok "MongoDB deployed on NodePort $MONGO_NODEPORT"
  fi

  # ── 4. Deploy Ollama ──
  log "Deploying Ollama ($OLLAMA_REPLICAS replicas)..."
  echo "$OLLAMA_MANIFEST" | remote_master "cat > /tmp/ollama.yaml && k3s kubectl apply -f /tmp/ollama.yaml"
  remote_master "k3s kubectl wait --for=condition=Ready pod -l app=ollama --timeout=180s" || warn "Ollama pods taking time..."
  ok "Ollama deployed on NodePort $OLLAMA_NODEPORT"

  # ── 5. Pull models ──
  cmd_sync_models

  # ── 6. Deploy backend ──
  cmd_deploy_backend

  # ── 7. Deploy frontend ──
  cmd_deploy_frontend

  # ── 8. Sync users ──
  sleep 5
  cmd_sync_users

  ok "=== Setup complete! ==="
  echo "  Web UI:   http://$MASTER_IP:30080  (frontend pod → nginx proxy)"
  echo "  Backend:  http://$MASTER_IP:30500  (backend pod NodePort)"
  echo "  Ollama:   http://$MASTER_IP:$OLLAMA_NODEPORT  (inference NodePort)"
  echo "  MongoDB:  $MASTER_IP:$MONGO_NODEPORT  (internal only)"
}

cmd_uninstall() {
  log "Uninstalling from all nodes..."
  warn "This will remove K3s, all pods, and all data."
  read -rp "Type 'yes' to confirm: " confirm
  [[ "$confirm" == "yes" ]] || { echo "Aborted."; exit 0; }

  log "Removing K3s from master..."
  remote_master "k3s-uninstall.sh 2>/dev/null || true"

  log "Removing K3s agent from worker..."
  $SSH $WORKER_IP "k3s-agent-uninstall.sh 2>/dev/null || true"

  log "Stopping backend..."
  remote_master "pkill -f 'node server.js' 2>/dev/null || true"

  log "Removing nginx config..."
  remote_master "rm -rf /var/www/html/* && systemctl restart nginx 2>/dev/null || true"

  ok "Uninstall complete"
}

cmd_status() {
  log "Cluster Status"
  echo ""
  remote_master "k3s kubectl get nodes -o wide" 2>/dev/null || warn "K3s not running on master"
  echo ""
  remote_master "k3s kubectl get pods -A" 2>/dev/null || true
  echo ""
  log "Models on cluster"
  curl -s "http://$MASTER_IP:$OLLAMA_NODEPORT/api/tags" 2>/dev/null | \
    python3 -c "import json,sys; [print(f\"  {m['name']}\") for m in json.load(sys.stdin).get('models',[])]" \
    || warn "Ollama not reachable"
  echo ""
  log "Service Health"
  curl -s "http://$MASTER_IP:30080/health" 2>/dev/null | \
    python3 -c "import json,sys; d=json.load(sys.stdin); print(f\"  Backend: {d['status']}, MongoDB: {d['mongo']}, Ollama: {d['ollama']}\")" \
    || warn "Backend pod not reachable at http://$MASTER_IP:30080/health"
}

cmd_sync_models() {
  log "Syncing models per config..."

  MODELS=$(python3 -c "
import json
d = json.load(open('$CONFIG'))
for m in d['ollama']['models']:
    print(m)
")

  # Get all Ollama pods
  PODS=$(remote_master "k3s kubectl get pods -l app=ollama -o jsonpath='{.items[*].metadata.name}'" 2>/dev/null || echo "")

  for MODEL in $MODELS; do
    log "Ensuring $MODEL is pulled on all pods..."
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

_build_and_push_image() {
  local name="$1" dir="$2"
  log "Building $name image..."
  docker build -t "$name:latest" "$dir" --quiet
  docker save "$name:latest" -o "/tmp/${name}.tar"
  $SCP "/tmp/${name}.tar" "$SSH_USER@$MASTER_IP:/tmp/"
  remote_master "k3s ctr images import /tmp/${name}.tar"
  ok "$name image imported into k3s"
}

cmd_deploy_backend() {
  log "Building and deploying backend pod..."
  (cd "$BACKEND_DIR" && npm install --production --silent)
  _build_and_push_image "ollama-backend" "$BACKEND_DIR"

  echo "$APP_MANIFEST" | remote_master "cat > /tmp/app.yaml && k3s kubectl apply -f /tmp/app.yaml"
  remote_master "k3s kubectl rollout restart deployment/ollama-backend"
  remote_master "k3s kubectl wait --for=condition=Ready pod -l app=ollama-backend --timeout=60s"
  sleep 3
  curl -sf "http://$MASTER_IP:30080/health" && ok "Backend running (via pod)" || warn "Health check failed"
}

cmd_deploy_frontend() {
  log "Building and deploying frontend pod..."
  (cd "$FRONTEND_DIR" && npm install --silent && npm run build)
  _build_and_push_image "ollama-frontend" "$FRONTEND_DIR"

  echo "$APP_MANIFEST" | remote_master "cat > /tmp/app.yaml && k3s kubectl apply -f /tmp/app.yaml"
  remote_master "k3s kubectl rollout restart deployment/ollama-frontend"
  remote_master "k3s kubectl wait --for=condition=Ready pod -l app=ollama-frontend --timeout=60s"
  ok "Frontend deployed at http://$MASTER_IP:30080"
}

cmd_sync_users() {
  log "Syncing users from config.json..."
  USERS=$(python3 -c "
import json
d = json.load(open('$CONFIG'))
for u in d['users']:
    print(u['username'], u['password'], u.get('role','user'), u.get('email',''))
")

  while IFS=' ' read -r username password role email; do
    [[ -z "$username" ]] && continue
    RESULT=$(curl -s -X POST "http://$MASTER_IP:30080/api/admin/users" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $(get_admin_token)" \
      -d "{\"username\":\"$username\",\"password\":\"$password\",\"role\":\"$role\",\"email\":\"$email\"}" 2>/dev/null)

    if echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); exit(0 if 'id' in d or 'already' in d.get('error','') else 1)" 2>/dev/null; then
      ok "User '$username' ($role) ready"
    else
      warn "User '$username': $RESULT"
    fi
  done <<< "$USERS"
}

get_admin_token() {
  ADMIN_CREDS=$(python3 -c "
import json
d = json.load(open('$CONFIG'))
for u in d['users']:
    if u.get('role') == 'admin':
        print(u['username'], u['password'])
        break
")
  ADMIN_USER=$(echo $ADMIN_CREDS | awk '{print $1}')
  ADMIN_PASS=$(echo $ADMIN_CREDS | awk '{print $2}')

  # Bootstrap first admin if DB is empty
  curl -s -X POST "http://$MASTER_IP:30080/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" 2>/dev/null | \
    python3 -c "import json,sys; print(json.load(sys.stdin)['token'])" 2>/dev/null || \
    bootstrap_first_admin "$ADMIN_USER" "$ADMIN_PASS"
}

bootstrap_first_admin() {
  local user="$1" pass="$2"
  # Directly insert into MongoDB if login fails (first-time setup)
  remote_master "k3s kubectl exec deploy/mongodb -- mongosh '$MONGO_DB' \
    -u '$MONGO_USER' -p '$MONGO_PASS' --authenticationDatabase admin \
    --eval \"
const bcrypt = require;
db.users.updateOne(
  {username: '$user'},
  {\\\$setOnInsert: {username:'$user', passwordHash:'\$(python3 -c \"import bcrypt; print(bcrypt.hashpw(b'$pass', bcrypt.gensalt()).decode())\" 2>/dev/null || echo PLACEHOLDER)', role:'admin', createdAt: new Date()}},
  {upsert: true}
)\" 2>/dev/null || true"
  # Retry login
  curl -s -X POST "http://$MASTER_IP:30080/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$user\",\"password\":\"$pass\"}" 2>/dev/null | \
    python3 -c "import json,sys; print(json.load(sys.stdin)['token'])" 2>/dev/null || echo ""
}

cmd_add_user() {
  local target_user="${1:-}"
  [[ -z "$target_user" ]] && { echo "Usage: ./run.sh add-user <username>"; exit 1; }

  USER_DATA=$(python3 -c "
import json
d = json.load(open('$CONFIG'))
for u in d['users']:
    if u['username'] == '$target_user':
        print(u['username'], u['password'], u.get('role','user'), u.get('email',''))
        break
")
  [[ -z "$USER_DATA" ]] && err "User '$target_user' not found in config.json"

  read -r username password role email <<< "$USER_DATA"
  TOKEN=$(get_admin_token)
  RESULT=$(curl -s -X POST "http://$MASTER_IP:30080/api/admin/users" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"username\":\"$username\",\"password\":\"$password\",\"role\":\"$role\",\"email\":\"$email\"}")
  echo "$RESULT" | python3 -c "import json,sys; d=json.load(sys.stdin); print('Created:', d.get('username',''), d.get('role',''), '|', d.get('error',''))" 2>/dev/null
  ok "Done"
}

cmd_remove_user() {
  local target_user="${1:-}"
  [[ -z "$target_user" ]] && { echo "Usage: ./run.sh remove-user <username>"; exit 1; }

  TOKEN=$(get_admin_token)
  USER_ID=$(curl -s "http://$MASTER_IP:30080/api/admin/users" \
    -H "Authorization: Bearer $TOKEN" 2>/dev/null | \
    python3 -c "import json,sys; users=json.load(sys.stdin); print(next((u['_id'] for u in users if u['username']=='$target_user'),''))" 2>/dev/null)

  [[ -z "$USER_ID" ]] && err "User '$target_user' not found in the database"

  curl -s -X DELETE "http://$MASTER_IP:30080/api/admin/users/$USER_ID" \
    -H "Authorization: Bearer $TOKEN" >/dev/null
  ok "User '$target_user' deleted (along with their conversations)"
}

cmd_logs() {
  log "Backend pod logs..."
  remote_master "k3s kubectl logs -l app=ollama-backend -f --tail=100"
}

# ─── Entry point ─────────────────────────────────────────────────────────────

COMMAND="${1:-help}"
shift || true

case "$COMMAND" in
  setup)          cmd_setup ;;
  uninstall)      cmd_uninstall ;;
  status)         cmd_status ;;
  sync-models)    cmd_sync_models ;;
  sync-users)     cmd_sync_users ;;
  add-user)       cmd_add_user "${1:-}" ;;
  remove-user)    cmd_remove_user "${1:-}" ;;
  deploy-backend) cmd_deploy_backend ;;
  deploy-frontend) cmd_deploy_frontend ;;
  logs)           cmd_logs ;;
  help|--help|-h)
    echo "Ollama Cluster Manager"
    echo ""
    echo "Usage: ./run.sh <command> [args]"
    echo ""
    echo "Commands:"
    echo "  setup              Full cluster setup (K3s + MongoDB + Ollama + app)"
    echo "  uninstall          Remove everything from all nodes"
    echo "  status             Show cluster, model, and service status"
    echo "  sync-models        Sync models from config.json to all Ollama pods"
    echo "  sync-users         Create/update all users from config.json"
    echo "  add-user <name>    Add a specific user from config.json"
    echo "  remove-user <name> Delete a user from MongoDB"
    echo "  deploy-backend     Reinstall deps and restart backend"
    echo "  deploy-frontend    Rebuild React app and deploy to nginx"
    echo "  logs               Tail backend logs"
    ;;
  *)
    echo "Unknown command: $COMMAND. Run './run.sh help' for usage."
    exit 1
    ;;
esac
