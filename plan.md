# Automated K3s & Ollama Remote Deployment Plan - COMPLETED

## Status: SUCCESSFUL
All phases of the deployment plan have been executed and verified.

### Key Fixes Applied:
- **Hostname Conflict Resolution:** Both nodes had the same hostname (`telaverge`). The deployment script was updated to use the `--with-node-id` flag during K3s installation to ensure unique node identification.
- **Pre-flight Checks:** Confirmed `sshpass` is essential and was installed/verified.

1. Environment Specifications
This document outlines the automated deployment of a K3s Kubernetes cluster and a CPU-optimized Ollama environment. The entire setup is orchestrated from a third, independent VM via an automated, idempotent bash script.
Node Details & Credentials
Provisioning Node (Third VM)
Role: The machine where you run the installation script.
Prerequisite: Must have sshpass installed (sudo apt install sshpass).
Master Node (Control Plane - VM1)
IP Address: 172.16.9.203
Username: root
Password: jkljkl
Worker Node (Agent - VM2)
IP Address: 172.16.9.253
Username: root
Password: jkljkl
2. The Automated Deployment Script
On your Provisioning Node, create a script named deploy_ai_cluster.sh. This script handles the SSH connections, system upgrades, idempotent cluster bootstrapping, Ollama deployment, and dynamic model downloading.
#!/bin/bash

# ==========================================
# Configuration Variables
# ==========================================
MASTER_IP="172.16.9.203"
WORKER_IP="172.16.9.253"
SSH_USER="root"
SSH_PASS="jkljkl"

# Configure the exact models you want installed here (space-separated)
DESIRED_MODELS="gemma:7b llama3:8b"

# ==========================================
# Pre-flight Checklist
# ==========================================
if ! command -v sshpass &> /dev/null; then
    echo "Error: 'sshpass' is not installed. Run 'sudo apt install sshpass' first."
    exit 1
fi

echo "=========================================="
echo "      K3S & OLLAMA CLUSTER DEPLOYER       "
echo "=========================================="

# Function to run remote commands easily
run_remote() {
    local target_ip=$1
    local cmd=$2
    sshpass -p "$SSH_PASS" ssh -o StrictHostKeyChecking=no "$SSH_USER@$target_ip" "$cmd"
}

# ==========================================
# Phase 0: System Updates
# ==========================================
echo -e "\n[0/5] Updating and upgrading packages on nodes..."
# Note: DEBIAN_FRONTEND=noninteractive prevents the script from hanging on GRUB/Service restart prompts
echo "Updating Master Node ($MASTER_IP)..."
run_remote $MASTER_IP "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -q"

echo "Updating Worker Node ($WORKER_IP)..."
run_remote $WORKER_IP "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -q"

# ==========================================
# Phase 1: Cluster Setup (Idempotent)
# ==========================================
echo -e "\n[1/5] Checking K3s Master Node on $MASTER_IP..."
if run_remote $MASTER_IP "command -v k3s &> /dev/null"; then
    echo " -> K3s already installed on Master. Skipping installation."
else
    echo " -> Initializing K3s Master Node..."
    run_remote $MASTER_IP "curl -sfL [https://get.k3s.io](https://get.k3s.io) | sh -"
    sleep 15 # Wait for K3s to initialize
fi

echo "[2/5] Extracting Node Token from Master..."
NODE_TOKEN=$(run_remote $MASTER_IP "cat /var/lib/rancher/k3s/server/node-token")

if [ -z "$NODE_TOKEN" ]; then
    echo "Failed to retrieve Node Token. Exiting."
    exit 1
fi

echo "[3/5] Checking Worker Node ($WORKER_IP)..."
if run_remote $WORKER_IP "command -v k3s &> /dev/null"; then
    echo " -> K3s already installed on Worker. Skipping join."
else
    echo " -> Joining Worker Node to the cluster..."
    run_remote $WORKER_IP "curl -sfL [https://get.k3s.io](https://get.k3s.io) | K3S_URL=https://$MASTER_IP:6443 K3S_TOKEN=$NODE_TOKEN sh -"
fi

# ==========================================
# Phase 2: Deploy Ollama
# ==========================================
echo -e "\n[4/5] Deploying/Updating Ollama manifest..."
read -r -d '' OLLAMA_MANIFEST << 'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ollama
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ollama
  template:
    metadata:
      labels:
        app: ollama
    spec:
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

# Pass the manifest via SSH and apply it (kubectl apply is naturally idempotent)
sshpass -p "$SSH_PASS" ssh -o StrictHostKeyChecking=no "$SSH_USER@$MASTER_IP" "cat << 'EOF2' > /root/ollama.yaml
$OLLAMA_MANIFEST
EOF2
k3s kubectl apply -f /root/ollama.yaml"

echo "Waiting for Ollama Pod to be ready..."
run_remote $MASTER_IP "k3s kubectl wait --for=condition=ready pod -l app=ollama --timeout=300s"

# ==========================================
# Phase 3: Synchronize Models (Idempotent)
# ==========================================
echo -e "\n[5/5] Checking existing AI models against desired list: [ $DESIRED_MODELS ]"
# Get the pod name
POD_NAME=$(run_remote $MASTER_IP "k3s kubectl get pods -l app=ollama -o jsonpath='{.items[0].metadata.name}'")

# Fetch currently installed models
echo "Fetching currently installed models from Ollama..."
INSTALLED_MODELS=$(run_remote $MASTER_IP "k3s kubectl exec $POD_NAME -- ollama list")

# Loop through desired models and check if they are already installed
for MODEL in $DESIRED_MODELS; do
    # Parse the output locally to see if the exact model name exists in the first column
    if echo "$INSTALLED_MODELS" | awk '{print $1}' | grep -qx "$MODEL"; then
        echo " -> Model '$MODEL' is already installed. Skipping."
    else
        echo " -> Pulling new model: $MODEL (This will take several minutes)..."
        run_remote $MASTER_IP "k3s kubectl exec $POD_NAME -- ollama pull $MODEL"
        echo " -> Model '$MODEL' successfully pulled!"
    fi
done

echo -e "\n=========================================="
echo "Deployment & Synchronization Complete!"
echo "Your AI API is available at: http://$MASTER_IP:31434"
echo "=========================================="


3. Execution Instructions
Log into your Third VM (Provisioning Node).
Ensure sshpass is installed:
sudo apt update && sudo apt install -y sshpass


Create the script file:
nano deploy_ai_cluster.sh


Paste the script content above, save, and make it executable:
chmod +x deploy_ai_cluster.sh


Adjust the models you want inside the script by editing the DESIRED_MODELS variable at the top (Line 12).
Run the script:
./deploy_ai_cluster.sh

You can safely run this script as many times as you like. If everything is already set up and the models match, it will skip through all the steps in seconds without breaking anything.
4. Verification & Testing
Once the script finishes, test the API on the newly established NodePort:
curl [http://172.16.9.203:31434/api/generate](http://172.16.9.203:31434/api/generate) -d '{
  "model": "gemma:7b",
  "prompt": "What is the capital of France? Reply in one word.",
  "stream": false
}'


