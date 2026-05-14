#!/bin/bash

# VM Snapshot Revert Script
# Reverts VMs 172.16.9.203 and 172.16.9.253 to their snapshots

set -e

SSH_USER="subhasish"
SSH_HOST="172.16.2.30"
SSH_PASS="subhasish@123"

VM1="172.16.9.203"
VM1_SNAPSHOT="fresh"

VM2="172.16.9.253"
VM2_SNAPSHOT="Fresh"

echo "========================================="
echo " VM Snapshot Revert Script"
echo "========================================="

sshpass -p "$SSH_PASS" ssh -o StrictHostKeyChecking=no "${SSH_USER}@${SSH_HOST}" bash << EOF

  echo ""
  echo ">>> Checking snapshots for VM: $VM1"
  sudo virsh snapshot-list $VM1

  echo ""
  echo ">>> Reverting $VM1 to snapshot: '$VM1_SNAPSHOT'"
  sudo virsh snapshot-revert $VM1 $VM1_SNAPSHOT
  echo "✔ $VM1 reverted successfully"

  echo ""
  echo ">>> Checking snapshots for VM: $VM2"
  sudo virsh snapshot-list $VM2

  echo ""
  echo ">>> Reverting $VM2 to snapshot: '$VM2_SNAPSHOT'"
  sudo virsh snapshot-revert $VM2 $VM2_SNAPSHOT
  echo "✔ $VM2 reverted successfully"

  echo ""
  echo "========================================="
  echo " All VMs reverted successfully!"
  echo "========================================="

EOF