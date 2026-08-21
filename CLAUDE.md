# OANDA Trading Bot — Project Context

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Frontend    │────▶│  Backend (Node)  │────▶│  OANDA API  │
│  React/Vite  │     │  Express+WS      │     │  Demo/Live  │
│  (Render)    │     │  (Render)        │     └─────────────┘
└─────────────┘     │                  │
                    │  ┌───────────┐   │     ┌──────────────────┐
                    │  │ ML Client │───┼────▶│  ML Service       │
                    │  └───────────┘   │     │  Python/FastAPI   │
                    └──────┬───────────┘     │  TensorFlow/LSTM  │
                           │                 │  (Render)         │
                    ┌──────▼───────┐         └────────┬─────────┘
                    │              │                   │
              ┌─────▼─────┐  ┌────▼──────┐   ┌───────▼────────┐
              │ Cloudflare │  │  MongoDB  │   │  MongoDB Atlas │
              │ D1 Worker  │  │  Atlas    │   │  (ML models)   │
              │ (candles)  │  │  (ops)    │   │  MODEL_STORAGE │
              └────────────┘  └───────────┘   │  =mongo        │
                                              └────────────────┘
```

## Data Storage Split

### Cloudflare D1 (via Worker)
- **Candle data** — all OHLCV candles (EUR_USD M1/M15/H1/H4)
- Worker URL: `https://trading-bot-d1.baraiyadhruv1221.workers.dev`
- D1 Database ID: `2f7bfb08-ef7d-41d3-b98f-f1e7a7248f17`
- Region: APAC (Singapore)
- API_KEY: set as Cloudflare secret (encrypted), also in Render env vars

### MongoDB Atlas (free tier — 512MB)
- **Operational data**: trades, signals, strategies, decision logs, account snapshots, sentiments, backtest results
- **ML model weights**: stored as binary in `ml_models` collection (MODEL_STORAGE=mongo)
- Connection: `mongodb+srv://dhruvbaraiya:Asd123@cluster0.4leg3v4.mongodb.net/trading`
- Usage after candle migration: ~27MB (well within 512MB limit)

### R2 (future — not enabled yet)
- When ready: enable R2 in Cloudflare dashboard, uncomment R2 binding in `packages/d1-worker/wrangler.toml`, redeploy Worker, set `MODEL_STORAGE=r2` on Render
- Will store ML model weights (currently ~6MB total)

## Key Environment Variables

### Backend (Render)
```
OANDA_API_TOKEN=<oanda token>
OANDA_ACCOUNT_ID=<oanda account>
OANDA_BASE_URL=https://api-fxpractice.oanda.com
MONGODB_URI=mongodb+srv://dhruvbaraiya:Asd123@cluster0.4leg3v4.mongodb.net/trading
ML_SERVICE_URL=https://trading-bot-ml-hv3o.onrender.com
D1_WORKER_URL=https://trading-bot-d1.baraiyadhruv1221.workers.dev
D1_API_KEY=<the secret key>
```

### ML Service (Render)
```
MONGODB_URI=mongodb+srv://dhruvbaraiya:Asd123@cluster0.4leg3v4.mongodb.net/trading
D1_WORKER_URL=https://trading-bot-d1.baraiyadhruv1221.workers.dev
D1_API_KEY=<the secret key>
MODEL_STORAGE=mongo  (switch to "r2" when R2 enabled)
```

## Session Log — 2026-08-21

### What was done
1. **Cloned repo** to `D:\project\Bot`
2. **Researched MongoDB Atlas crisis**: 512MB limit hit. Candles = 398MB (M1 alone = 331MB). Everything else = 27MB.
3. **Evaluated Cloudflare deployment**: Frontend (Pages) = works. Backend/ML (Workers) = blocked (WebSocket, Redis, Python).
4. **Built Cloudflare D1 integration**:
   - `packages/d1-worker/` — Cloudflare Worker with D1 (candles) + R2 (models, optional)
   - `packages/backend/src/data/D1Client.ts` — drop-in HTTP client replacing CandleModel
   - `packages/ml-service/app/data/d1_client.py` — Python equivalent
   - Refactored all backend files using CandleModel → D1CandleClient
   - Added MODEL_STORAGE flag (mongo/r2) for future R2 switch
5. **Deployed D1 Worker** to Cloudflare (APAC region)
6. **Tested locally**: Worker health, candle CRUD, model upload/download, H1 migration (33,827 candles verified)
7. **Added server-side migration route**: `POST /api/migrate/candles-to-d1` — runs on Render, no local terminal needed
8. **Committed and pushed** to GitHub

### What needs to be done next
1. **Set Render env vars** for backend: `D1_WORKER_URL` and `D1_API_KEY`
2. **Set Render env vars** for ML service: `D1_WORKER_URL`, `D1_API_KEY`, `MODEL_STORAGE=mongo`
3. **Wait for Render auto-deploy** (triggered by git push)
4. **Run migration**:
   ```
   POST https://trading-bot-backend-ml50.onrender.com/api/migrate/candles-to-d1
   Body: {"skipM1": true}   ← 235K candles, ~18 min
   Body: {"skipM1": false}  ← 2.4M candles, ~3 hrs
   ```
5. **Check migration progress**:
   ```
   GET https://trading-bot-backend-ml50.onrender.com/api/migrate/status
   ```
6. **After migration**: optionally delete candles collection from Atlas to free space
7. **When ready for R2**: enable R2 in Cloudflare dashboard → uncomment R2 in wrangler.toml → redeploy Worker → set MODEL_STORAGE=r2

### UptimeRobot
- Pings `trading-bot-backend-ml50.onrender.com/api/health` every 5-10 min
- Prevents Render free tier spin-down
- Keeps migration alive

## Development Commands

```bash
# Backend dev
pnpm dev:backend

# Frontend dev
pnpm dev:frontend

# D1 Worker dev (local)
cd packages/d1-worker && pnpm dev

# D1 Worker deploy
cd packages/d1-worker && pnpm run deploy

# D1 schema init (remote)
cd packages/d1-worker && pnpm run db:init

# D1 schema init (local)
cd packages/d1-worker && pnpm run db:init:local

# Set Worker secret
cd packages/d1-worker && printf 'your-key' | npx wrangler secret put API_KEY

# Migration (local script)
python scripts/migrate-to-d1.py --mongodb-uri "..." --d1-url "..." --api-key "..."
```

## ML Training Flow
1. Train locally (needs GPU/RAM for TensorFlow LSTM)
2. Weights saved to `packages/ml-service/models/` (local) + MongoDB Atlas `ml_models` collection
3. Deploy ML service on Render → loads weights from MongoDB on startup
4. Backend calls ML service `POST /predict` for trading decisions
