# Phase 7: AI/ML Prediction Layer — Design Spec

## Overview

Add an AI/ML prediction layer to the trading bot using a Dual LSTM architecture (Universal + Specialist models). The ML service runs as a Python FastAPI microservice alongside the existing Node.js backend. A meta-controller combines rule-based signals with AI predictions to make final trading decisions.

**Target:** >= 54% directional accuracy out-of-sample.
**Approach:** Dual LSTM with multi-timeframe input and M1 microstructure features.

---

## 1. Model Architecture

### 1.1 Universal Model (ForexLSTM-Universal)

Learns general forex/market patterns across multiple instruments. Predicts price direction and magnitude.

- **Input shape:** `(60, 49)` — 60 H1 candles × 49 features per candle
- **Training data:** 6+ major pairs × 5 years H1 = ~940K candles total
- **Pair embedding:** 8-dim vector concatenated before first LSTM

```
Input(60, 49)
→ Pair Embedding(8) concatenated
→ LSTM(128, return_sequences=True, dropout=0.2)
→ LSTM(64, return_sequences=True, dropout=0.2)
→ Attention(64)
→ Dense(32, relu)
→ Dropout(0.3)
→ Output heads:
    - direction: Dense(3, softmax) → [UP, DOWN, FLAT]
    - magnitude: Dense(1, linear) → predicted pip change (ATR-normalized)
```

### 1.2 Specialist Model (ForexLSTM-Specialist)

Per-instrument model that scores rule-based signals and suggests position sizing. Trained on backtest/paper trade outcomes.

- **Input shape:** `(60, 55)` — 49 base features + 6 signal features
- **Signal features:** which strategy fired, signal direction, indicator values at signal time
- **One model per traded instrument** — EUR_USD first

```
Input(60, 55)
→ LSTM(64, return_sequences=True, dropout=0.2)
→ LSTM(32, dropout=0.2)
→ Dense(16, relu)
→ Output heads:
    - confidence: Dense(1, sigmoid) → 0-1 probability signal is profitable
    - optimal_size: Dense(1, relu) → position size multiplier (0.5x - 2.0x)
```

---

## 2. Feature Engineering

### 2.1 Feature Groups (49 features per H1 candle)

#### Group A: Base OHLCV (5)
```
open, high, low, close, volume
→ Transformed to: log_return, high_low_range, close (ref), volume_delta
```

#### Group B: Technical Indicators (15)
Computed by existing Node.js IndicatorEngine, passed to Python.
```
rsi_value                           # RSI(14)
macd_value, macd_signal, macd_hist  # MACD(12,26,9)
bb_upper, bb_middle, bb_lower, bb_percentB  # BB(20,2)
atr_value                           # ATR(14)
ema_short, ema_mid, ema_long        # EMA(20,50,200)
rsi_divergence                      # price new high but RSI not
macd_zero_distance                  # MACD distance from zero line
```

#### Group C: M1 Microstructure (8)
Derived from 60 M1 candles within each H1 candle. Captures intra-hour price behavior invisible to OHLCV.
```
intra_volatility       = std(m1_returns)
intra_reversals        = count(sign_changes(m1_closes))
intra_max_drawdown     = max_peak_to_trough(m1_cumulative)
intra_trend_strength   = abs(h1_return) / sum(abs(m1_returns))
early_vs_late          = return(m1[0:30]) - return(m1[30:60])
intra_volume_skew      = max(m1_volumes) / mean(m1_volumes)
close_position         = (close - min(m1_lows)) / (max(m1_highs) - min(m1_lows))
momentum_acceleration  = linregress_slope(m1_returns)
```

#### Group D: M15 Momentum (4)
```
m15_ret_1  = return of last M15 candle
m15_ret_2  = return of 2nd last M15
m15_ret_3  = return of 3rd last M15
m15_ret_4  = return of 4th last M15
```

#### Group E: H4 Context (4)
```
h4_position   = where current price sits in H4 range
h4_trend      = H4 EMA20 vs EMA50 direction
h4_rsi        = H4 RSI value
h4_atr_ratio  = H4 ATR / H1 ATR (volatility regime)
```

#### Group F: Time/Session (7)
```
hour_sin       = sin(2π * hour / 24)
hour_cos       = cos(2π * hour / 24)
day_sin        = sin(2π * weekday / 5)
day_cos        = cos(2π * weekday / 5)
session        = one-hot (Asian 0-8 UTC / London 8-16 / NY 13-21)
month_end      = binary (last 3 days of month)
is_nfp_week    = binary (first Friday of month week)
```

#### Group G: OANDA Sentiment (3)
```
long_ratio           = % of OANDA traders long
net_position_change  = delta from previous hour
extreme_sentiment    = binary (ratio > 0.7 or < 0.3)
```

#### Group H: Currency Strength (3)
```
eur_strength          = avg EUR return vs basket (GBP, JPY, CHF)
usd_strength          = avg USD return vs basket
strength_divergence   = rate of change difference
```

### 2.2 Normalization

| Feature type | Method |
|---|---|
| Price-derived (returns, ATR, ranges) | Rolling 252-period z-score |
| Bounded (RSI, BB%B, long_ratio) | Min-max [0, 1] |
| Binary (month_end, nfp_week) | No normalization |
| Cyclical (hour, day) | Already sin/cos encoded |

### 2.3 Label Generation

**Universal Model:**
```python
future_return = (close[t+6] - close[t]) / close[t]
threshold = 0.5 * atr[t]

direction_label:
  UP   if future_return > threshold
  DOWN if future_return < -threshold
  FLAT if abs(future_return) <= threshold

magnitude_label = future_return / atr[t]  # ATR-normalized
```

**Specialist Model:**
```python
confidence_label:
  1.0 if trade hit take_profit
  0.0 if trade hit stop_loss
  0.5 if closed for other reason

size_label = actual_pnl_pips / expected_pnl_pips  # clamped [0.5, 2.0]
```

---

## 3. Data Pipeline

### 3.1 Raw Data Sources

| Source | Endpoint | Purpose | Storage |
|---|---|---|---|
| H1 candles | OANDA `/v3/instruments/{pair}/candles?granularity=H1` | Primary TF | MongoDB `candles_h1` |
| M1 candles | OANDA `/v3/instruments/{pair}/candles?granularity=M1` | Microstructure | MongoDB `candles_m1` (90-day rolling) |
| M15 candles | OANDA `/v3/instruments/{pair}/candles?granularity=M15` | Momentum | MongoDB `candles_m15` |
| H4 candles | OANDA `/v3/instruments/{pair}/candles?granularity=H4` | Trend context | MongoDB `candles_h4` |
| Order book | OANDA `/v3/instruments/{pair}/orderBook` | Sentiment | MongoDB `sentiment` |
| Position book | OANDA `/v3/instruments/{pair}/positionBook` | Sentiment | MongoDB `sentiment` |

### 3.2 Pipeline Flow

```
DATA COLLECTOR (Node.js, every H1 close)
  → Fetch H1, M15, M1, H4 candles
  → Fetch order/position book
  → Compute indicators (IndicatorEngine)
  → Store to MongoDB
       │
       ▼
FEATURE EXTRACTOR (Python)
  → Load candles from MongoDB
  → Compute M1 microstructure per H1
  → Compute M15 momentum, H4 context
  → Compute time/session/sentiment/strength
  → Normalize (rolling z-score / min-max)
  → Build lookback windows (60, 49)
  → Generate labels (training only)
  → Output: numpy arrays
       │
       ├──→ TRAINING: fit model → save .h5
       └──→ INFERENCE: last 60 candles → prediction
```

### 3.3 Data Split (Chronological, No Shuffle)

```
Train:       2019-01-01 to 2022-12-31  (4 years, ~35K H1 candles)
Validation:  2023-01-01 to 2023-06-30  (6 months, ~4.3K candles)
Test:        2023-07-01 to 2023-12-31  (6 months, ~4.3K candles)
Live:        2024-01-01 onwards
```

Walk-forward validation for hyperparameter tuning.

### 3.4 Storage Estimates

| Collection | Records/year | Size 5yr |
|---|---|---|
| candles_h1 | 8,760 | ~9 MB |
| candles_m15 | 35,040 | ~35 MB |
| candles_m1 | 525,600 | ~400 MB (1yr rolling) |
| candles_h4 | 2,190 | ~2 MB |
| sentiment | 8,760 | ~22 MB |
| features | 8,760 | ~18 MB |
| **Total** | | **~486 MB** |

---

## 4. FastAPI ML Service

### 4.1 Endpoints

```
GET  /health           → service status + loaded model info
POST /predict          → prediction for current market state
POST /predict/batch    → batch predictions (backtesting)
POST /train            → trigger model training
GET  /model/status     → training progress, metrics, version
POST /model/switch     → swap active model version
GET  /metrics          → prediction accuracy tracking
```

### 4.2 `/predict` Request

```json
{
  "instrument": "EUR_USD",
  "timestamp": "2024-06-15T14:00:00Z",
  "candles_h1": [{"t":"...","o":1.0840,"h":1.0855,"l":1.0832,"c":1.0848,"v":12450}],
  "candles_m1": [{"t":"...","o":1.0848,"h":1.0850,"l":1.0846,"c":1.0849,"v":230}],
  "candles_m15": [{"t":"...","o":1.0845,"h":1.0850,"l":1.0840,"c":1.0848,"v":3200}],
  "candles_h4": [{"t":"...","o":1.0830,"h":1.0860,"l":1.0825,"c":1.0848,"v":45000}],
  "indicators": {
    "rsi": 54.2, "macd": 0.00012, "macd_signal": 0.00008, "macd_hist": 0.00004,
    "bb_upper": 1.089, "bb_middle": 1.0855, "bb_lower": 1.082, "bb_percentB": 0.42,
    "atr": 0.0035, "ema_short": 1.0852, "ema_mid": 1.0845, "ema_long": 1.083
  },
  "sentiment": {"long_ratio": 0.62, "prev_long_ratio": 0.58},
  "rule_signal": {"direction": "BUY", "strategy_name": "EMA Trend Pullback", "strategy_id": "..."}
}
```

### 4.3 `/predict` Response

```json
{
  "universal": {
    "direction": "UP",
    "direction_probabilities": {"UP": 0.62, "DOWN": 0.25, "FLAT": 0.13},
    "magnitude_pips": 18.5,
    "model_version": "universal-v1.2",
    "inference_time_ms": 12
  },
  "specialist": {
    "signal_confidence": 0.78,
    "size_multiplier": 1.3,
    "model_version": "specialist-EUR_USD-v1.0",
    "inference_time_ms": 8
  },
  "meta": {
    "final_direction": "BUY",
    "final_confidence": 0.72,
    "position_size_factor": 1.3,
    "action": "TRADE",
    "reasoning": [
      "Universal: UP 62% (above 54% threshold)",
      "Specialist: 78% confidence (above 60% threshold)",
      "Rule signal agrees: BUY — triple confirmation",
      "Size boosted 1.3x — high confidence alignment"
    ]
  },
  "timestamp": "2024-06-15T14:00:01Z"
}
```

---

## 5. Meta-Controller

### 5.1 Decision Matrix

| Rules | Universal AI | Specialist | Action |
|---|---|---|---|
| BUY | UP > 54% | > 60% | TRADE (full size × specialist multiplier) |
| BUY | UP > 54% | < 60% | TRADE (0.5x size) |
| BUY | FLAT | > 60% | TRADE (0.5x size) |
| BUY | DOWN | any | SKIP (AI disagrees) |
| FLAT | UP > 60% | n/a | AI TRADE (0.5x size) |
| FLAT | UP > 70% | n/a | AI TRADE (1.0x size) |
| FLAT | < 60% | n/a | NO TRADE |

Same logic mirrored for SELL/DOWN.

### 5.2 Confidence Formula

```
final_confidence = 0.4 × universal_probability
                 + 0.3 × specialist_confidence
                 + 0.3 × (rule_agrees ? 1.0 : 0.0)
```

### 5.3 Position Sizing

```
base_size = RiskEngine.calculatePositionSize()
final_size = base_size × specialist.size_multiplier × confidence_scale(final_confidence)

confidence_scale:
  < 0.50  → 0.5x
  0.50-0.70 → 0.75x
  0.70-0.85 → 1.0x
  > 0.85  → 1.25x (max)

Hard cap: max size_multiplier = 1.5x
```

### 5.4 Safety Rails

- Min confidence 0.54 to trade (match accuracy target)
- RiskEngine limits ALWAYS override meta-controller
- First 30 days: AI can only FILTER, not initiate trades
- ML service timeout > 2s → fallback to rules-only
- ML service down → rules-only mode (current behavior)
- AI blocks 5 consecutive rule signals → alert user

### 5.5 AutoTrader Integration

Current flow:
```
Strategy conditions → SignalEngine → RiskEngine → Place order
```

New flow:
```
Strategy conditions → SignalEngine ─┐
                                     ├→ Meta-Controller → RiskEngine → Place order
ML Service /predict ────────────────┘
```

---

## 6. Training Pipeline & Model Lifecycle

### 6.1 Instrument Registry (Extensibility Core)

All instrument-specific config in one place. Adding new instrument = adding one entry.

```python
INSTRUMENT_REGISTRY = {
    "EUR_USD": {
        "type": "forex",
        "broker": "oanda",
        "pip_value": 0.0001,
        "typical_spread_pips": 1.0,
        "sessions": ["london", "ny", "asian"],
        "trading_hours": "24h",
        "strength_basket": ["GBP_USD", "USD_JPY", "USD_CHF"],
        "label_horizon": 6,
        "label_threshold_atr": 0.5,
        "tradeable": True,
    },
    # Data-only instruments (OANDA provides candle data but account can't trade)
    "XAU_USD": {
        "type": "commodity",
        "broker": "capitalcom",  # trade via Capital.com when added
        "pip_value": 0.01,
        "typical_spread_pips": 30,
        "sessions": ["london", "ny"],
        "strength_basket": ["USD_JPY", "EUR_USD"],
        "label_horizon": 4,
        "label_threshold_atr": 0.3,
        "tradeable": False,  # data-only until Capital.com adapter built
    },
}
```

### 6.2 Model Registry (MongoDB)

```json
{
  "name": "universal-v1.2",
  "type": "universal",
  "instrument": null,
  "file_path": "models/universal-v1.2.h5",
  "status": "active",
  "training_config": {
    "instruments": ["EUR_USD"],
    "date_range": ["2019-01-01", "2022-12-31"],
    "epochs_run": 67,
    "feature_count": 49
  },
  "metrics": {
    "test_accuracy": 0.573,
    "test_precision_up": 0.58,
    "test_precision_down": 0.55,
    "val_loss": 0.648,
    "profit_factor_backtest": 1.35
  },
  "created_at": "...",
  "promoted_at": "...",
  "retired_at": null
}
```

### 6.3 Model Lifecycle

```
TRAINED → passes accuracy > 54%
  → STAGING (shadow mode: predicts but doesn't trade, 7 days)
    → ACTIVE (predictions used by meta-controller)
      → RETIRED (new model promoted OR accuracy < 52%)
```

- Only 1 active universal model at a time
- Only 1 active specialist per instrument
- Auto-retire if rolling 30-day accuracy < 52%

### 6.4 Training Hyperparameters

```python
TRAINING_CONFIG = {
    "universal": {
        "lookback_window": 60,
        "feature_count": 49,
        "lstm_layers": [128, 64],
        "attention": True,
        "dropout": 0.2,
        "dense_units": 32,
        "batch_size": 64,
        "max_epochs": 100,
        "early_stop_patience": 10,
        "reduce_lr_patience": 5,
        "optimizer": "adam",
        "initial_lr": 0.001,
        "loss_direction": "categorical_crossentropy",
        "loss_magnitude": "mse",
        "loss_weights": {"direction": 0.7, "magnitude": 0.3},
    },
    "specialist": {
        "lookback_window": 60,
        "feature_count": 55,
        "lstm_layers": [64, 32],
        "attention": False,
        "dropout": 0.2,
        "dense_units": 16,
        "batch_size": 32,
        "max_epochs": 80,
        "loss_confidence": "binary_crossentropy",
        "loss_size": "mse",
        "loss_weights": {"confidence": 0.6, "size": 0.4},
    },
}
```

### 6.5 Retraining Strategy

| Trigger | Action |
|---|---|
| Every 30 days | Scheduled retrain with latest data |
| Rolling accuracy < 53% | Performance-triggered retrain |
| Manual POST /train | User-triggered |

Retraining includes latest data, keeps same split structure, must pass staging gate before promotion. Old model kept for rollback.

---

## 7. Performance Monitoring & Continuous Learning

### 7.1 Prediction Tracking

Every prediction stored in MongoDB `ai_predictions`:
```json
{
  "timestamp": "...",
  "instrument": "EUR_USD",
  "model_version": "universal-v1.2",
  "predicted_direction": "UP",
  "predicted_confidence": 0.62,
  "predicted_magnitude_pips": 18.5,
  "rule_signal": "BUY",
  "meta_action": "TRADE",
  "meta_confidence": 0.72,
  "actual_direction": null,
  "actual_magnitude_pips": null,
  "prediction_correct": null,
  "trade_placed": true,
  "trade_pnl": null
}
```

Actuals filled by outcome scorer running every H1 (t+6 lookback).

### 7.2 Alert Thresholds

| Condition | Window | Action |
|---|---|---|
| Accuracy < 53% | 48 hours | Notify user |
| Accuracy < 50% | 7 days | Auto-retire model, fallback to rules |
| Calibration drift > 10% | 200 predictions | Trigger retrain |
| AI blocks 5 rule signals | Consecutive | Notify user |
| Inference latency > 2s | Per request | Fallback to rules for that evaluation |

### 7.3 A/B Testing

When new model enters staging, run side-by-side for 7 days:
- Both models predict on same data
- Compare accuracy, profit factor
- Promote challenger if equal or better
- Min 100 predictions required

### 7.4 Regime Detection

```python
def detect_regime(candles_h1, window=252):
    returns = compute_returns(candles_h1[-window:])
    volatility = np.std(returns)
    trend = abs(np.mean(returns)) / volatility

    if trend > 0.15: return "TRENDING"
    elif volatility > historical_90th_percentile: return "VOLATILE"
    else: return "RANGING"
```

Log regime with each prediction. If accuracy differs > 10% across regimes, retrain with regime-aware features.

---

## 8. Broker Strategy — Dual Broker Plan

### 8.1 Current: OANDA

- 68 forex pairs tradeable
- Gold/Oil/Indices: candle data available but NOT tradeable (India region restriction)
- Primary broker for Phase 6-8

### 8.2 Future: Capital.com (Phase 9)

- Forex + Gold + Oil + Indices + Crypto all tradeable
- Free demo API: `https://demo-api-capital.backend-capital.com/`
- REST + WebSocket API
- Add `CapitalComAdapter` implementing existing `BrokerAdapter` interface

### 8.3 Multi-Broker Architecture

```
BrokerAdapter (interface)
  ├── OandaAdapter       → forex pairs
  └── CapitalComAdapter  → commodities, indices, crypto (future)

InstrumentRouter:
  EUR_USD → OandaAdapter
  XAU_USD → CapitalComAdapter
  US30_USD → CapitalComAdapter

Same AutoTrader, SignalEngine, RiskEngine, Meta-Controller for all.
```

### 8.4 Universal Model Benefits

Even before Capital.com integration, the universal model trains on OANDA's candle data for gold/indices (read-only). This gives the model cross-market pattern recognition without needing to trade those instruments.

---

## 9. File Structure

```
packages/ml-service/
├── app/
│   ├── main.py                    # FastAPI app + routes
│   ├── config.py                  # INSTRUMENT_REGISTRY + TRAINING_CONFIG
│   ├── routes/
│   │   ├── predict.py             # /predict endpoint
│   │   ├── train.py               # /train endpoint
│   │   └── model.py               # /model/* endpoints
│   ├── models/
│   │   ├── base.py                # BaseModel ABC
│   │   ├── universal.py           # UniversalLSTM(BaseModel)
│   │   └── specialist.py          # SpecialistLSTM(BaseModel)
│   ├── features/
│   │   ├── extractor.py           # FeatureExtractor (instrument-agnostic)
│   │   ├── microstructure.py      # M1 → microstructure features
│   │   ├── sentiment.py           # OANDA order book features
│   │   ├── strength.py            # Currency strength index
│   │   └── normalizer.py          # Rolling z-score, min-max
│   ├── training/
│   │   ├── pipeline.py            # End-to-end training orchestrator
│   │   ├── labels.py              # Label generation
│   │   ├── splitter.py            # Chronological train/val/test
│   │   └── evaluator.py           # Test metrics + backtest simulation
│   ├── data/
│   │   ├── mongo_client.py        # MongoDB connection
│   │   └── fetcher.py             # Fetch candles from MongoDB
│   └── meta/
│       └── controller.py          # Meta-controller logic
├── models/                        # Saved .h5 files (gitignored)
├── tests/
├── requirements.txt
└── Dockerfile
```

Adding new instrument = add entry to `INSTRUMENT_REGISTRY` in `config.py` + download data + train. No code changes.

---

## 10. Phase 6 Data Collection (Start Now)

Begin collecting additional data during paper trading to maximize Phase 7 training data:

| Data | How | Status |
|---|---|---|
| H1 candles + indicators | Already collected by AutoTrader | ✅ Done |
| M1 candles (60 per H1) | Add scheduled job, store 90-day rolling | ❌ To implement |
| M15 candles | Add to data collector | ❌ To implement |
| H4 candles | Add to data collector | ❌ To implement |
| OANDA order/position book | Add hourly fetch job | ❌ To implement |
| Trade outcomes | Already logged in decision log | ✅ Done |

Estimated storage: ~50 MB/month for EUR_USD across all timeframes.

---

## 11. Success Criteria

| Metric | Target |
|---|---|
| Direction accuracy (test set) | >= 54% |
| Direction accuracy (live 30-day) | >= 54% |
| Profit factor (AI-augmented backtest) | > rules-only PF |
| Max inference latency | < 500ms (p99 < 2s) |
| Uptime | 99%+ (with rules-only fallback) |
| False positive rate | < 40% (AI-initiated trades) |

## 12. Implementation Order

```
Phase 7a: Data collection pipeline (M1, M15, H4, sentiment) — during Phase 6
Phase 7b: Feature extractor + normalizer (Python)
Phase 7c: Universal LSTM training on EUR_USD
Phase 7d: /predict endpoint + AutoTrader integration
Phase 7e: Meta-controller + safety rails
Phase 7f: Specialist model (after sufficient trade outcome data)
Phase 7g: Performance monitoring + A/B testing
Phase 7h: Continuous learning loop

Future:
Phase 9a: Capital.com BrokerAdapter
Phase 9b: Add XAU_USD, US30_USD to instrument registry
Phase 9c: Multi-instrument specialist models
```
