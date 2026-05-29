# Plan A — OANDA Trading Bot (v1.1)

## Project Overview
Automated Forex trading bot using OANDA v20 REST API.
Developer (coder) + Trader (friend). 3-layer decision: Indicators → AI → Risk Check.

## Tech Stack
- **Backend:** Node.js + Express + TypeScript
- **Frontend:** React + Vite + TradingView Lightweight Charts
- **Database:** MongoDB Atlas (free tier)
- **Queue:** Redis + BullMQ
- **ML:** Python FastAPI + LSTM (TensorFlow/Keras)
- **Real-time:** Socket.IO
- **Broker SDK:** @oanda/v20

## Phases

### Phase 0 — Foundation (Week 1)
- [ ] Init git repo + pnpm monorepo
- [ ] docker-compose.yml (MongoDB, Redis)
- [ ] MongoDB Atlas free tier connection
- [ ] Basic Express API skeleton + health check
- [ ] GitHub Actions CI
- **GATE:** Local dev running. Trader has OANDA demo credentials.

### Phase 1 — Data Pipeline + OANDA Connection (Weeks 2-3)
- [ ] @oanda/v20 + BrokerAdapter interface
- [ ] Implement: getCandles, streamPricing, placeOrder, getPositions, closePosition
- [ ] closeAllTrades loop workaround (kill switch)
- [ ] Download 5yr Dukascopy data → MongoDB
- [ ] Smoke test: place + cancel 1-unit demo order
- **GATE:** EUR/USD streaming. Demo order tested. Kill switch tested.

### Phase 2 — Indicator Engine + Dashboard (Weeks 3-4)
- [ ] technicalindicators → candle store
- [ ] RSI, MACD, BB, ATR, EMA on candle close
- [ ] React dashboard v1: live chart + indicators
- [ ] Manual trade trigger button
- **GATE:** Indicators match TradingView. Trader sees live chart.

### Phase 3 — Strategy Builder + Rule Engine (Weeks 4-5)
- [ ] Strategy Builder panel (sliders, dropdowns)
- [ ] Signal generation pipeline
- [ ] Signal Review Feed
- **GATE:** Trader configures strategies independently.

### Phase 4 — Backtesting (Weeks 5-6)
- [ ] @fugle/backtest framework
- [ ] 2019-2024 data, spread + slippage included
- [ ] Results dashboard: equity curve, metrics
- **GATE:** Sharpe > 0.8, Max DD < 20%, PF > 1.3 (2024 OOS).

### Phase 5 — Risk Engine (Week 6)
- [ ] Full risk engine (0.5%/trade, 2%/day, 5%/week, 10% max DD)
- [ ] Kill switch loop logic
- [ ] Stale signal rejection (5sec cutoff)
- [ ] News blackout
- **GATE:** All limits tested. Kill switch <1 sec.

### Phase 6 — Paper Trading (Weeks 7-8)
- [ ] Bot → fxPractice automated, 30 days
- [ ] Full decision logging to MongoDB
- [ ] Monitoring alerts (email/Slack)
- **GATE:** 30 days clean. Performance in range.

### Phase 7 — AI/ML Layer (Weeks 9-11)
- [ ] Python FastAPI + LSTM (EUR/USD H1, 5yr)
- [ ] POST /predict endpoint
- [ ] Integrate into meta-controller
- **GATE:** AI >= 54% OOS. Combined > rules-only.

### Phase 8 — Live Funding (Month 3+)
- [ ] fxPractice → fxTrade (same API, diff base URL)
- [ ] Halve risk for month 1
- **GATE:** Trader's call. 90 days proven.

### Phase 9 — Scaling (Month 6+)
- [ ] VPS, multi-pair, RL agent experimental
- **GATE:** Sharpe > 1.0, Max DD < 10%, 100+ live trades.

## OANDA API — Missing Ops Workarounds
| Operation | Status | Workaround |
|---|---|---|
| Close all orders | Not supported | Loop GET /orders → cancel each |
| Close all orders on pair | Not supported | Same loop, filtered by instrument |
| Close all trades | Not supported | Loop GET /trades → close each |
| Stale order rejection | Not supported | Code-level: reject signals >5sec old |

All workarounds complete in <100ms with 3-trade max (9 API calls at 120/sec).

## Key Numbers
| Param | Value |
|---|---|
| Risk/trade | 0.5% (max 1%) |
| Daily loss | 2% → bot stops |
| Weekly loss | 5% → 24hr pause |
| Max drawdown | 10% → bot disables |
| Kill switch | <100ms |
| Rate limit | 120 req/sec |
| AI target | 54%+ directional |

## API Quick Reference
- Demo: `https://api-fxpractice.oanda.com`
- Live: `https://api-fxtrade.oanda.com`
- Candles: `GET /v3/instruments/{pair}/candles`
- Stream: `GET /v3/accounts/{id}/pricing/stream`
- Order: `POST /v3/accounts/{id}/orders`
- Close trade: `PUT /v3/accounts/{id}/trades/{tradeID}/close`
- Cancel order: `PUT /v3/accounts/{id}/orders/{orderID}/cancel`
