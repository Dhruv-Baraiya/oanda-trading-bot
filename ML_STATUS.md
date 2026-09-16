# ML Model Improvement — Status (2026-08-29)

## Current State
- **AutoTrader**: Running on Railway, 8 strategies, ML enabled
- **Backend**: `oanda-trading-bot-production-17fa.up.railway.app`
- **ML Service**: `captivating-dream-production-8a42.up.railway.app`
- **Active Model**: LightGBM v2 (universal-lgbm-latest), 45 features, 53.0% val acc

---

## DONE

### Hosting Migration (Render → Railway)
- Backend + ML Service deployed on Railway (Render free tier exhausted)
- Dockerfiles for both services, auto-deploy on git push
- UptimeRobot updated to Railway URL

### Indicator Normalization Fix
- Removed all raw price-level features from `compute_indicators()`
- Now returns 12 scale-invariant features:
  `atr_pct, rsi, macd_norm, macd_signal_norm, macd_hist_norm, bb_percentB, bb_width, ema_short_dist, ema_mid_dist, ema_long_dist, ema_spread, rsi_divergence`

### LightGBM v2 Trained & Deployed
- 409K samples from EUR_USD + GBP_USD (H1 + M15)
- 45 normalized features, no raw price leakage
- Top features: ret_std_50, ema_spread, macd_signal_norm, bb_width
- Saved to MongoDB as universal-lgbm-v2 + universal-lgbm-latest

### Signal Spam Fix
- ML was firing on all 8 strategies per cycle (up to 8 duplicate orders/min)
- Added `mlInitiatedThisCycle` Set — max 1 ML-initiated trade per instrument per cycle

### Ghost Order Fix
- OANDA cancelled orders (market closed / FOK) were logged as ORDER_PLACED with price=0
- Now throws on `orderCancelTransaction`/`orderRejectTransaction` → logged as ORDER_REJECTED

### Market Hours Guard
- Bot was evaluating strategies on weekends, sending unfillable orders
- Added `isForexMarketOpen()` — skips evaluation Fri 21:00 → Sun 21:00 UTC

### Data Backfills
| Pair | H1 | M15 |
|------|-----|-----|
| EUR_USD | 33,952 | 189,755 |
| GBP_USD | 47,558 | 190,176 |
| USD_JPY | 47,701 | 140,000 (partial — D1 limit hit) |
| USD_CHF | **PENDING** | **PENDING** |

### Training Attempts Summary
| Version | Model | Train Acc | Val Acc | Notes |
|---------|-------|-----------|---------|-------|
| v8 | LSTM(32,16) | 56% | 53.4% | Best LSTM |
| v9 | CNN+LSTM(32,16) | 69% | 51.5% | Overfit badly |
| v10 | LSTM(24)+L2+smooth | 53% | 50.6% | Underfit |
| LGBM v1 | LightGBM | 58.2% | 51.9% | Raw indicators leak |
| LGBM v2 | LightGBM | 56.4% | 53.0% | Normalized features, 410K samples, 2 pairs |

---

## PENDING

### 1. Complete Backfills (D1 Worker daily limit reset needed)
After midnight UTC, retry:
- USD_JPY M15: remaining ~50K candles (from where it left off)
- USD_CHF H1: full backfill (~47K candles)
- USD_CHF M15: full backfill (~190K candles)

### 2. Retrain LightGBM v3 with All 4 Pairs
After backfills complete (~800K+ samples):
```bash
cd packages/ml-service
python -c "
from app.training.lgbm_pipeline import LGBMPipeline
p = LGBMPipeline()
r = p.train_universal(
    instruments=['EUR_USD', 'GBP_USD', 'USD_JPY', 'USD_CHF'],
    granularities=['H1', 'M15'],
    version='v3',
)
print(r)
"
```

### 3. Other Pending Items
- SendGrid sender verification for email alerts
- Monitor bot trading when market opens Sunday 21:00 UTC

---

## Architecture

```
Backend (Node/Railway) → POST /predict → ML Service (Python/Railway)
                                          ├── LightGBM (primary, ~1ms)
                                          ├── LSTM (fallback, ~500ms)
                                          └── Specialist LSTM (EUR_USD)
                                               ↓
                                          MetaController:
                                          - Rule signal direction
                                          - LightGBM UP probability
                                          - Specialist confidence
                                               ↓
                                          Action: TRADE / SKIP / AI_TRADE / NO_TRADE
```

## Key Files
- `app/features/indicators.py` — 12 normalized features (no raw prices)
- `app/features/flat_extractor.py` — LightGBM feature extraction (45 features)
- `app/models/lgbm_model.py` — LightGBM train/save/load
- `app/training/lgbm_pipeline.py` — multi-pair training
- `app/routes/predict.py` — prediction endpoint (LGBM primary)
- `packages/backend/src/autotrader/AutoTrader.ts` — signal spam fix + market hours
- `packages/backend/src/broker/OandaAdapter.ts` — cancelled order detection
