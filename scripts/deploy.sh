#!/bin/bash
# Deploy trading bot to VPS
# Usage: ./scripts/deploy.sh <VPS_IP> [SSH_KEY_PATH]

set -e

VPS_IP="${1:?Usage: deploy.sh <VPS_IP> [SSH_KEY_PATH]}"
SSH_KEY="${2:-~/.ssh/id_rsa}"
SSH_CMD="ssh -i $SSH_KEY ubuntu@$VPS_IP"
REMOTE_DIR="/opt/trading-bot"

echo "=== Deploying to $VPS_IP ==="

# Ensure remote directory exists
$SSH_CMD "sudo mkdir -p $REMOTE_DIR && sudo chown ubuntu:ubuntu $REMOTE_DIR"

# Sync files (exclude unnecessary)
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude 'dist' \
  --exclude '.env' \
  --exclude '.env.production' \
  --exclude 'packages/frontend' \
  -e "ssh -i $SSH_KEY" \
  . ubuntu@$VPS_IP:$REMOTE_DIR/

# Build and restart
$SSH_CMD "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml up -d --build"

echo "=== Deploy complete ==="
echo "Health check: curl http://$VPS_IP:3001/api/health"
