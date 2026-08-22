import os
from pathlib import Path

try:
    _env_path = Path(__file__).resolve().parents[3] / ".env"
    if _env_path.exists():
        for line in _env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())
except (IndexError, OSError):
    pass

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017/trading")
MODEL_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "models")
MODEL_STORAGE = os.getenv("MODEL_STORAGE", "mongo")  # "mongo" or "r2"

INSTRUMENT_REGISTRY = {
    "EUR_USD": {
        "type": "forex",
        "pip_value": 0.0001,
        "sessions": ["london", "ny", "asian"],
        "strength_basket": ["GBP_USD", "USD_JPY", "USD_CHF"],
        "label_horizon": 6,
        "label_threshold_atr": 0.5,
        "tradeable": True,
    },
}

TRAINING_CONFIG = {
    "universal": {
        "lookback_window": 30,
        "feature_count": 44,
        "lstm_layers": [32, 16],
        "attention": False,
        "dropout": 0.4,
        "dense_units": 16,
        "batch_size": 128,
        "max_epochs": 100,
        "early_stop_patience": 15,
        "reduce_lr_patience": 7,
        "initial_lr": 0.0005,
        "loss_weights": {"direction": 1.0, "magnitude": 0.0},
    },
    "specialist": {
        "lookback_window": 60,
        "feature_count": 44,
        "lstm_layers": [64, 32],
        "attention": False,
        "dropout": 0.2,
        "dense_units": 16,
        "batch_size": 32,
        "max_epochs": 80,
        "loss_weights": {"confidence": 0.6, "optimal_size": 0.4},
    },
}
