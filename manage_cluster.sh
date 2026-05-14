#!/bin/bash

# ==============================================================================
# K3s & Ollama HA Cluster Manager
# Handles: HA Cluster, Ollama (2 Replicas), Models, Backend API, and Frontend UI
# ==============================================================================

# Configuration
MASTER_IP="172.16.9.203"
WORKER_IP="172.16.9.253"
SSH_USER="root"
SSH_PASS="jkljkl"
DESIRED_MODELS="gemma:7b llama3:8b llava:7b"

# Project paths (Local)
PROJECT_DIR="/root/claude_code/ollama"
BACKEND_DIR="$PROJECT_DIR/chat-app/backend"
FRONTEND_DIR="$PROJECT_DIR/chat-app/frontend"

run_remote() {
    local target_ip=$1
    local cmd=$2
    sshpass -p "$SSH_PASS" ssh -o StrictHostKeyChecking=no "$SSH_USER@$target_ip" "$cmd"
}

scp_to_remote() {
    local target_ip=$1
    local src=$2
    local dest=$3
    sshpass -p "$SSH_PASS" scp -o StrictHostKeyChecking=no "$src" "$SSH_USER@$target_ip:$dest"
}

# ==============================================================================
# UNINSTALL MODE
# ==============================================================================
uninstall() {
    echo "=========================================="
    echo "      UNINSTALLING ENTIRE STACK           "
    echo "=========================================="

    echo "[1/4] Stopping Backend API on Master..."
    run_remote $MASTER_IP "pkill node || true"

    echo "[2/4] Removing Frontend (Nginx) on Master..."
    run_remote $MASTER_IP "apt-get remove --purge -y nginx nginx-common && rm -rf /var/www/html/*"

    echo "[3/4] Uninstalling K3s from all nodes..."
    run_remote $MASTER_IP "[ -f /usr/local/bin/k3s-uninstall.sh ] && /usr/local/bin/k3s-uninstall.sh"
    run_remote $WORKER_IP "[ -f /usr/local/bin/k3s-uninstall.sh ] && /usr/local/bin/k3s-uninstall.sh"

    echo "[4/4] Cleaning up local temporary files..."
    rm -f "$PROJECT_DIR/frontend-build.tar.gz"
    
    echo "✔ Uninstallation Complete!"
}

# ==============================================================================
# INSTALL MODE
# ==============================================================================
install() {
    echo "=========================================="
    echo "      INSTALLING HA AI CLUSTER            "
    echo "=========================================="

    # --- Phase 1: HA Cluster Setup ---
    echo -e "\n[1/6] Initializing HA Master (Node 1)..."
    run_remote $MASTER_IP "curl -sfL https://get.k3s.io | sh -s - server --cluster-init --with-node-id --node-name k3s-node-1"
    
    echo "Waiting for Master to initialize..."
    sleep 20
    
    NODE_TOKEN=$(run_remote $MASTER_IP "cat /var/lib/rancher/k3s/server/node-token")
    if [ -z "$NODE_TOKEN" ]; then echo "Failed to get token!"; exit 1; fi

    echo "[2/6] Joining HA Server (Node 2)..."
    run_remote $WORKER_IP "curl -sfL https://get.k3s.io | K3S_URL=https://$MASTER_IP:6443 K3S_TOKEN=$NODE_TOKEN sh -s - server --with-node-id --node-name k3s-node-2"

    # --- Phase 2: Deploy Ollama HA ---
    echo -e "\n[3/6] Deploying Ollama (2 Replicas, Anti-Affinity)..."
    cat <<EOF > ollama-ha.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ollama
spec:
  replicas: 2
  strategy:
    type: Recreate
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
          requiredDuringSchedulingIgnoredDuringExecution:
          - labelSelector:
              matchExpressions:
              - key: app
                operator: In
                values:
                - ollama
            topologyKey: "kubernetes.io/hostname"
      containers:
      - name: ollama
        image: ollama/ollama:latest
        ports:
        - containerPort: 11434
        resources:
          requests:
            cpu: "4"
            memory: "8Gi"
          limits:
            cpu: "8"
            memory: "16Gi"
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
      nodePort: 31434
EOF
    scp_to_remote $MASTER_IP "ollama-ha.yaml" "/root/ollama-ha.yaml"
    run_remote $MASTER_IP "k3s kubectl apply -f /root/ollama-ha.yaml"
    
    echo "Waiting for Ollama Pods..."
    run_remote $MASTER_IP "k3s kubectl wait --for=condition=ready pod -l app=ollama --timeout=300s"

    # --- Phase 3: Model Sync ---
    echo -e "\n[4/6] Synchronizing AI Models across both nodes..."
    run_remote $MASTER_IP "cat << 'EOF2' > /root/pull_models.sh
#!/bin/bash
MODELS=\"$DESIRED_MODELS\"
PODS=\$(k3s kubectl get pods -l app=ollama -o jsonpath='{.items[*].metadata.name}')
for POD in \$PODS; do
    echo \"Processing Pod: \$POD\"
    for MODEL in \$MODELS; do
        echo \" -> Pulling \$MODEL in \$POD...\"
        k3s kubectl exec \$POD -- ollama pull \$MODEL
    done
done
EOF2
chmod +x /root/pull_models.sh && /root/pull_models.sh"

    # --- Phase 4: Backend API ---
    echo -e "\n[5/6] Deploying Backend API Proxy to Master..."
    run_remote $MASTER_IP "curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs"
    scp_to_remote $MASTER_IP "$BACKEND_DIR/server.js" "/root/server.js"
    scp_to_remote $MASTER_IP "$BACKEND_DIR/package.json" "/root/package.json"
    run_remote $MASTER_IP "npm install multer pdf-parse && (pkill node || true) && (nohup node server.js > backend.log 2>&1 &)"

    # --- Phase 5: Frontend UI ---
    echo -e "\n[6/6] Building and Deploying Frontend UI..."
    cd "$FRONTEND_DIR" && npm run build
    tar -czf "$PROJECT_DIR/frontend-build.tar.gz" -C build .
    scp_to_remote $MASTER_IP "$PROJECT_DIR/frontend-build.tar.gz" "/tmp/frontend-build.tar.gz"
    run_remote $MASTER_IP "apt-get install -y nginx && rm -rf /var/www/html/* && tar -xzf /tmp/frontend-build.tar.gz -C /var/www/html/ && sed -i 's/listen 80/listen 3000/' /etc/nginx/sites-available/default && systemctl restart nginx"

    echo -e "\n=========================================="
    echo "      INSTALLATION COMPLETE!              "
    echo "UI: http://$MASTER_IP:3000"
    echo "API: http://$MASTER_IP:5000/api/chat"
    echo "=========================================="
}

# Main Execution
case "$1" in
    install)
        install
        ;;
    uninstall)
        uninstall
        ;;
    *)
        echo "Usage: $0 {install|uninstall}"
        exit 1
esac
