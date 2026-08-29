# ML Model Improvement — Status (2026-08-22)

## Current State
- **AutoTrader**: Running, 8 strategies, ML enabled, 0 errors
- **ML Service**: Live on Render, models loaded from MongoDB
- **Latest commit**: `ec8be38` — LightGBM implementation

---

## DONE

### Binary Classification Switch (v8)
- Switched from 3-class (UP/DOWN/FLAT) to binary (UP/DOWN)
- Simplified LSTM(32,16), dropout 0.4, lookback 30
- **Result**: 53.4% val accuracy (best LSTM so far)

### Predict Endpoint Fix
- Removed FLAT key reference causing KeyError/422
- Fixed lookback mismatch (extractor vs model)
- Updated MLClient.ts TypeScript interface

### Noise Label Filter
- Exclude training samples where price moved < 0.3 ATR
- Removes ~4,300 coin-flip samples from 33K → 29K useful samples

### Price Action Features (8 new)
- body_ratio, upper/lower wicks, dist_to_high/low
- consecutive direction count, volatility regime, gap size

### LightGBM Implementation
- `app/models/lgbm_model.py` — train/save/load via MongoDB
- `app/features/flat_extractor.py` — 47 flat features per candle
- `app/training/lgbm_pipeline.py` — multi-pair, multi-granularity support
- `app/routes/predict.py` — LightGBM primary, LSTM fallback
- `requirements.txt` — added lightgbm, joblib

### Data Backfill Started
- **GBP_USD H1**: DONE (47,568 candles)
- **GBP_USD M15**: RUNNING (queued, will finish in ~30 min)

### Training Attempts Summary
| Version | Model | Train Acc | Val Acc | Notes |
|---------|-------|-----------|---------|-------|
| v8 | LSTM(32,16) | 56% | 53.4% | Best LSTM |
| v9 | CNN+LSTM(32,16) | 69% | 51.5% | Overfit badly |
| v10 | LSTM(24)+L2+smooth | 53% | 50.6% | Underfit |
| LGBM v1 | LightGBM | 58.2% | 51.9% | Raw indicators leak |

---

## PENDING (Next Session)

### 1. Fix Indicator Normalization (DONE)
All raw price-level features removed from `compute_indicators()`. Now returns 12 scale-invariant features:
`atr_pct, rsi, macd_norm, macd_signal_norm, macd_hist_norm, bb_percentB, bb_width, ema_short_dist, ema_mid_dist, ema_long_dist, ema_spread, rsi_divergence`

### 2. Queue Remaining Backfills
After GBP_USD M15 finishes, queue (one at a time via background endpoint):
```
POST /api/datacollector/backfill/background
- USD_JPY H1: {"instrument":"USD_JPY","granularity":"H1","from":"2019-01-01","to":"2026-08-22"}
- USD_JPY M15: {"instrument":"USD_JPY","granularity":"M15","from":"2019-01-01","to":"2026-08-22"}
- USD_CHF H1: {"instrument":"USD_CHF","granularity":"H1","from":"2019-01-01","to":"2026-08-22"}
- USD_CHF M15: {"instrument":"USD_CHF","granularity":"M15","from":"2019-01-01","to":"2026-08-22"}
```
Check status: `GET /api/datacollector/backfill/status`

### 3. Retrain LightGBM with Fixed Features + All Pairs
After indicators fixed and all backfills done:
```bash
cd /mnt/c/Users/barai/OneDrive/Desktop/project/Trading/oanda-trading-bot/packages/ml-service
python -c "
from app.training.lgbm_pipeline import LGBMPipeline
p = LGBMPipeline()
r = p.train_universal(
    instruments=['EUR_USD', 'GBP_USD', 'USD_JPY', 'USD_CHF'],
    granularities=['H1', 'M15'],
    version='v2',
)
print(r)
"
```
Expected: 55-58% val accuracy with ~800K+ samples and clean features.

### 4. Deploy Updated ML Service
After training with good accuracy:
```bash
git add . && git commit && git push  # triggers Render auto-deploy
```

### 5. GPU Training (Optional)
GPU never worked in training — LD_LIBRARY_PATH export runs but CUDA libs not found.
Fix: run `export LD_LIBRARY_PATH=...` BEFORE the training command in same shell.
Not critical — LightGBM trains in seconds on CPU anyway.

### 6. Other Pending Items
- SendGrid sender verification for email alerts
- UptimeRobot still pinging backend (keeps Render alive)
- Monitor bot trading when market opens Sunday night

---

## Architecture

```
Backend (Node) → POST /predict → ML Service (Python/FastAPI)
                                    ├── LightGBM (primary, ~1ms inference)
                                    ├── LSTM (fallback, ~500ms inference)
                                    └── Specialist LSTM (sizing/confidence)
                                         ↓
                                    MetaController combines:
                                    - Rule signal direction
                                    - LightGBM UP probability
                                    - Specialist confidence
                                         ↓
                                    Action: TRADE / SKIP / AI_TRADE / NO_TRADE
```

## Key Files
- `app/features/indicators.py` — 12 normalized features (no raw prices)
- `app/features/flat_extractor.py` — LightGBM feature extraction
- `app/models/lgbm_model.py` — LightGBM train/save/load
- `app/training/lgbm_pipeline.py` — multi-pair training
- `app/routes/predict.py` — prediction endpoint (LGBM primary)
- `app/config.py` — model hyperparameters
