import numpy as np
from datetime import datetime
from tensorflow import keras
from app.config import TRAINING_CONFIG
from app.data.fetcher import fetch_candles, fetch_sentiment
from app.features.extractor import FeatureExtractor
from app.training.labels import generate_direction_labels, generate_specialist_labels_synthetic
from app.models.universal import build_universal_model, save_universal_model
from app.models.specialist import build_specialist_model, save_specialist_model


class TrainingPipeline:
    def __init__(self, instrument: str = "EUR_USD"):
        self.instrument = instrument
        self.extractor = FeatureExtractor(lookback=TRAINING_CONFIG["universal"]["lookback_window"])
        self.status = {"state": "idle", "progress": 0, "message": "", "metrics": {}}

    def train_universal(
        self,
        train_start: str = "2019-01-01",
        train_end: str = "2025-12-31",
        val_start: str = "2026-01-01",
        val_end: str = "2026-12-31",
        version: str = "v1",
    ) -> dict:
        self.status = {"state": "loading_data", "progress": 10, "message": "Fetching candles...", "metrics": {}}

        # Fetch data
        h1 = fetch_candles(self.instrument, "H1", datetime.fromisoformat(train_start), datetime.fromisoformat(val_end))
        m1 = fetch_candles(self.instrument, "M1", datetime.fromisoformat(train_start), datetime.fromisoformat(val_end))
        m15 = fetch_candles(self.instrument, "M15", datetime.fromisoformat(train_start), datetime.fromisoformat(val_end))
        h4 = fetch_candles(self.instrument, "H4", datetime.fromisoformat(train_start), datetime.fromisoformat(val_end))
        sentiment = fetch_sentiment(self.instrument, "positionBook", datetime.fromisoformat(train_start), datetime.fromisoformat(val_end))

        if len(h1) < 1000:
            self.status = {"state": "error", "progress": 0, "message": f"Not enough H1 data: {len(h1)} candles (need 1000+)", "metrics": {}}
            return self.status

        self.status["state"] = "extracting_features"
        self.status["progress"] = 30
        self.status["message"] = f"Extracting features from {len(h1)} candles..."

        # Extract features
        features = self.extractor.extract(h1, m1, m15, h4, sentiment)

        # Generate labels
        directions, magnitudes = generate_direction_labels(h1)

        lookback = TRAINING_CONFIG["universal"]["lookback_window"]
        # Align: features start at index `lookback`, labels from 0
        # After windowing, features[i] corresponds to h1[lookback + i]
        n_samples = min(len(features), len(directions) - lookback)
        if n_samples <= 0:
            self.status = {"state": "error", "progress": 0, "message": "Not enough aligned samples", "metrics": {}}
            return self.status

        X = features[:n_samples]
        y_dir = directions[lookback:lookback + n_samples]
        y_mag = magnitudes[lookback:lookback + n_samples]

        # Split train/val by date (chronological, no shuffle)
        train_end_dt = datetime.fromisoformat(train_end)
        h1_dates = h1.index[lookback:lookback + n_samples]
        train_mask = h1_dates <= train_end_dt
        val_mask = ~train_mask

        # Fallback: if either split is empty, use 80/20 chronological
        if val_mask.sum() == 0 or train_mask.sum() == 0:
            split_idx = int(n_samples * 0.8)
            train_mask = np.zeros(n_samples, dtype=bool)
            train_mask[:split_idx] = True
            val_mask = ~train_mask

        X_train, X_val = X[train_mask], X[val_mask]
        y_dir_train, y_dir_val = y_dir[train_mask], y_dir[val_mask]
        y_mag_train, y_mag_val = y_mag[train_mask], y_mag[val_mask]

        self.status["state"] = "training"
        self.status["progress"] = 50
        self.status["message"] = f"Training on {len(X_train)} samples, validating on {len(X_val)}..."

        # Build and train model
        cfg = TRAINING_CONFIG["universal"]
        model = build_universal_model(feature_count=X.shape[2], lookback=X.shape[1])

        callbacks = [
            keras.callbacks.EarlyStopping(patience=cfg["early_stop_patience"], restore_best_weights=True, monitor="val_direction_accuracy", mode="max"),
            keras.callbacks.ReduceLROnPlateau(patience=cfg["reduce_lr_patience"], factor=0.5, monitor="val_loss"),
        ]

        history = model.fit(
            X_train,
            {"direction": y_dir_train, "magnitude": y_mag_train},
            validation_data=(X_val, {"direction": y_dir_val, "magnitude": y_mag_val}),
            epochs=cfg["max_epochs"],
            batch_size=cfg["batch_size"],
            callbacks=callbacks,
            verbose=1,
        )

        # Evaluate
        self.status["state"] = "evaluating"
        self.status["progress"] = 90

        val_results = model.evaluate(
            X_val, {"direction": y_dir_val, "magnitude": y_mag_val}, verbose=0
        )

        metrics = {
            "train_samples": int(len(X_train)),
            "val_samples": int(len(X_val)),
            "val_loss": float(val_results[0]),
            "val_direction_accuracy": float(val_results[3]) if len(val_results) > 3 else 0,
            "epochs_run": len(history.history["loss"]),
            "feature_count": int(X.shape[2]),
        }

        # Save model
        path = save_universal_model(model, version)
        metrics["model_path"] = path

        self.status = {"state": "complete", "progress": 100, "message": "Training complete", "metrics": metrics}
        return self.status

    def train_specialist(
        self,
        train_start: str = "2019-01-01",
        train_end: str = "2025-12-31",
        val_end: str = "2026-12-31",
        version: str = "v1",
    ) -> dict:
        self.status = {"state": "loading_data", "progress": 10, "message": "Fetching candles for specialist...", "metrics": {}}

        h1 = fetch_candles(self.instrument, "H1", datetime.fromisoformat(train_start), datetime.fromisoformat(val_end))
        m1 = fetch_candles(self.instrument, "M1", datetime.fromisoformat(train_start), datetime.fromisoformat(val_end))
        m15 = fetch_candles(self.instrument, "M15", datetime.fromisoformat(train_start), datetime.fromisoformat(val_end))
        h4 = fetch_candles(self.instrument, "H4", datetime.fromisoformat(train_start), datetime.fromisoformat(val_end))
        sentiment = fetch_sentiment(self.instrument, "positionBook", datetime.fromisoformat(train_start), datetime.fromisoformat(val_end))

        if len(h1) < 1000:
            self.status = {"state": "error", "progress": 0, "message": f"Not enough H1 data: {len(h1)}", "metrics": {}}
            return self.status

        self.status = {"state": "extracting_features", "progress": 30, "message": f"Extracting features from {len(h1)} candles...", "metrics": {}}

        features = self.extractor.extract(h1, m1, m15, h4, sentiment)
        confidence, opt_size = generate_specialist_labels_synthetic(h1)

        lookback = TRAINING_CONFIG["universal"]["lookback_window"]
        n_samples = min(len(features), len(confidence) - lookback)
        if n_samples <= 0:
            self.status = {"state": "error", "progress": 0, "message": "Not enough aligned samples", "metrics": {}}
            return self.status

        X = features[:n_samples]
        y_conf = confidence[lookback:lookback + n_samples]
        y_size = opt_size[lookback:lookback + n_samples]

        # 80/20 chronological split
        split_idx = int(n_samples * 0.8)
        X_train, X_val = X[:split_idx], X[split_idx:]
        y_conf_train, y_conf_val = y_conf[:split_idx], y_conf[split_idx:]
        y_size_train, y_size_val = y_size[:split_idx], y_size[split_idx:]

        self.status = {"state": "training", "progress": 50, "message": f"Training specialist on {len(X_train)} samples, val {len(X_val)}...", "metrics": {}}

        cfg = TRAINING_CONFIG["specialist"]
        model = build_specialist_model(feature_count=X.shape[2], lookback=X.shape[1])

        callbacks = [
            keras.callbacks.EarlyStopping(patience=10, restore_best_weights=True),
            keras.callbacks.ReduceLROnPlateau(patience=5, factor=0.5),
        ]

        try:
            history = model.fit(
                X_train,
                {"confidence": y_conf_train, "optimal_size": y_size_train},
                validation_data=(X_val, {"confidence": y_conf_val, "optimal_size": y_size_val}),
                epochs=cfg["max_epochs"],
                batch_size=cfg["batch_size"],
                callbacks=callbacks,
                verbose=1,
            )
        except Exception as e:
            self.status = {"state": "error", "progress": 0, "message": f"Training failed: {e}", "metrics": {}}
            return self.status

        self.status["state"] = "evaluating"
        self.status["progress"] = 90

        val_results = model.evaluate(X_val, {"confidence": y_conf_val, "optimal_size": y_size_val}, verbose=0)

        metrics = {
            "train_samples": int(len(X_train)),
            "val_samples": int(len(X_val)),
            "val_loss": float(val_results[0]),
            "val_confidence_accuracy": float(val_results[3]) if len(val_results) > 3 else 0,
            "epochs_run": len(history.history["loss"]),
            "feature_count": int(X.shape[2]),
            "model_type": "specialist",
            "instrument": self.instrument,
        }

        path = save_specialist_model(model, self.instrument, version)
        metrics["model_path"] = path

        self.status = {"state": "complete", "progress": 100, "message": "Specialist training complete", "metrics": metrics}
        return self.status

    def get_status(self) -> dict:
        return self.status
