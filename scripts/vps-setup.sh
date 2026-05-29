#!/bin/bash
# First-time VPS setup for Oracle Cloud Free Tier (Ubuntu ARM)
# Run this ON the VPS after SSH login

set -e

echo "=== Updating system ==="
sudo apt update && sudo apt upgrade -y

echo "=== Installing Docker ==="
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

echo "=== Installing Docker Compose ==="
sudo apt install -y docker-compose-plugin

echo "=== Creating app directory ==="
sudo mkdir -p /opt/trading-bot
sudo chown $USER:$USER /opt/trading-bot

echo "=== Opening port 3001 ==="
sudo iptables -I INPUT -p tcp --dport 3001 -j ACCEPT
sudo apt install -y iptables-persistent
sudo netfilter-persistent save

echo ""
echo "=== Setup complete ==="
echo "IMPORTANT: Also open port 3001 in Oracle Cloud Console:"
echo "  Networking > Virtual Cloud Networks > your VCN > Security Lists > Add Ingress Rule"
echo "  Source CIDR: 0.0.0.0/0, Protocol: TCP, Dest Port: 3001"
echo ""
echo "Next steps:"
echo "  1. Log out and back in (for docker group)"
echo "  2. Clone your repo to /opt/trading-bot"
echo "  3. Copy .env.production with your OANDA creds"
echo "  4. Run: docker compose -f docker-compose.prod.yml up -d --build"
echo "  5. Check: curl http://localhost:3001/api/health"
