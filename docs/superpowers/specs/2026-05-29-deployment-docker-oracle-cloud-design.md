# Deployment: Docker + Oracle Cloud Free Tier

## Overview

Deploy the trading bot backend to Oracle Cloud Free Tier for 24/7 paper trading. Backend + MongoDB run in Docker containers on a single ARM VPS.

## Architecture

```
Oracle Cloud VPS (ARM, 4 cores, 24GB RAM, free forever)
├── docker-compose.prod.yml
│   ├── trading-backend  (Node 20, port 3001)
│   └── trading-mongodb  (Mongo 7, port 27017, persistent volume)
└── .env.production
```

Frontend stays local on laptop. Connects to VPS_IP:3001.

## Files to Create

### 1. `packages/backend/Dockerfile`
- Multi-stage build: install deps + compile TS → copy dist to slim runtime
- Base: `node:20-alpine`
- Production: `node dist/index.js`
- Health check: `curl http://localhost:3001/api/health`

### 2. `docker-compose.prod.yml`
- Backend service: build from `packages/backend/Dockerfile`, port 3001, restart unless-stopped
- MongoDB service: mongo:7, port 27017 (internal only), named volume
- Internal network between services
- `.env.production` file reference

### 3. `.env.production`
```
OANDA_API_TOKEN=<same>
OANDA_ACCOUNT_ID=<same>
OANDA_BASE_URL=https://api-fxpractice.oanda.com
MONGODB_URI=mongodb://trading-mongodb:27017/trading
PORT=3001
NODE_ENV=production
```

### 4. `scripts/deploy.sh`
- SSH to VPS, git pull, docker compose build + up

## Code Changes

1. Fix `dotenv.config()` path in `index.ts` — support both local dev and Docker
2. Add `GET /api/health` endpoint returning `{ status: "ok", uptime, ... }`
3. Add `.dockerignore` to exclude node_modules, dist, .env

## Oracle Cloud Setup Steps

1. Create free ARM instance (Ampere A1, 4 OCPU, 24GB RAM)
2. Open port 3001 in security list
3. SSH in, install Docker + Docker Compose
4. Clone repo, copy .env.production, docker compose up -d

## Monitoring

- `docker compose logs -f` for live logs
- Health check: `curl http://VPS_IP:3001/api/health`
- Auto-restart on crash via `restart: unless-stopped`
