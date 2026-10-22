import numpy as np
import pandas as pd
import lightgbm as lgb
from datetime import datetime
from app.data.fetcher import fetch_candles
from app.features.flat_extractor import FlatFeatureExtractor
from app.training.labels import generate_direction_labels
from app.models.lgbm_model import train_lgbm, save_lgbm_model, tune_lgbm


class LGBMPipeline:
    def __init__(self):
        self.extractor = FlatFeatureExtractor()
        self.status = {"state": "idle", "progress": 0, "message": "", "metrics": {}}

    def train_universal(
        self,
        instruments: list[str] = None,
        granularities: list[str] = None,
        train_start: str = "2019-01-01",
        train_end: str = "2025-12-31",
        val_end: str = "2026-12-31",
        version: str = "v1",
        horizon: int = 12,
        min_atr_move: float = 0.3,
        top_k_features: int = 0,
    ) -> dict:
        if instruments is None:
            instruments = ["EUR_USD"]
        if granularities is None:
            granularities = ["H1"]

        horizons = {"H1": horizon, "M15": 16, "H4": 3}

        self.status = {"state": "loading_data", "progress": 5, "message": "Fetching data...", "metrics": {}}

        start_dt = datetime.fromisoformat(train_start)
        end_dt = datetime.fromisoformat(val_end)

        all_X = []
        all_y = []
        all_dates = []

        for instrument in instruments:
            for gran in granularities:
                self.status["message"] = f"Fetching {instrument}/{gran}..."
                print(f"[LGBM] Fetching {instrument}/{gran}...")

                df = fetch_candles(instrument, gran, start_dt, end_dt)
                if len(df) < 500:
                    print(f"[LGBM] Skipping {instrument}/{gran} — only {len(df)} candles")
                    continue

                h = horizons.get(gran, horizon)
                features = self.extractor.extract(df)
                directions, magnitudes, valid_mask = generate_direction_labels(df, horizon=h, min_atr_move=min_atr_move)

                n = min(len(features), len(directions))
                features = features.iloc[:n]
                directions = directions[:n]
                valid = valid_mask[:n]

                X = features.values[valid]
                y = directions[valid]
                dates = features.index[:n][valid]

                print(f"[LGBM] {instrument}/{gran}: {len(df)} candles -> {len(X)} valid samples (h={h})")
                all_X.append(X)
                all_y.append(y)
                all_dates.append(dates)

        if not all_X:
            self.status = {"state": "error", "progress": 0, "message": "No data", "metrics": {}}
            return self.status

        X = np.vstack(all_X)
        y = np.concatenate(all_y)
        dates = np.concatenate(all_dates)

        print(f"[LGBM] Total: {len(X)} samples, {X.shape[1]} features")

        if top_k_features > 0 and top_k_features < X.shape[1]:
            print(f"[LGBM] Feature selection: training quick model to rank {X.shape[1]} features...")
            quick_model = lgb.LGBMClassifier(
                n_estimators=200, num_leaves=31, max_depth=6,
                learning_rate=0.05, verbose=-1, random_state=42,
            )
            split = int(len(X) * 0.8)
            quick_model.fit(X[:split], y[:split])
            importances = quick_model.feature_importances_
            top_indices = np.argsort(importances)[::-1][:top_k_features]
            top_indices = np.sort(top_indices)

            all_names = self.extractor.get_feature_names(
                fetch_candles(instruments[0], granularities[0],
                              datetime.fromisoformat(train_start),
                              datetime.fromisoformat(val_end)).head(300)
            )
            selected_names = [all_names[i] for i in top_indices] if len(all_names) == X.shape[1] else []
            print(f"[LGBM] Selected top {top_k_features} features: {selected_names[:10]}...")

            X = X[:, top_indices]
            self._selected_feature_indices = top_indices
            self._selected_feature_names = selected_names
            print(f"[LGBM] After selection: {X.shape[1]} features")
        else:
            self._selected_feature_indices = None
            self._selected_feature_names = None

        self.status = {"state": "splitting", "progress": 40, "message": f"Splitting {len(X)} samples...", "metrics": {}}

        train_end_dt = pd.Timestamp(train_end)
        train_mask = dates <= train_end_dt
        val_mask = ~train_mask

        if val_mask.sum() < 100 or train_mask.sum() < 100:
            split_idx = int(len(X) * 0.8)
            train_mask = np.zeros(len(X), dtype=bool)
            train_mask[:split_idx] = True
            val_mask = ~train_mask

        X_train, X_val = X[train_mask], X[val_mask]
        y_train, y_val = y[train_mask], y[val_mask]

        up_count = y_train.sum()
        print(f"[LGBM] Train: {len(X_train)} (UP={up_count:.0f}, DOWN={len(y_train)-up_count:.0f})")
        print(f"[LGBM] Val: {len(X_val)}")

        self.status = {"state": "tuning", "progress": 50, "message": f"Tuning LightGBM on {len(X_train)} samples...", "metrics": {}}

        best_params = tune_lgbm(X_train, y_train, X_val, y_val, n_trials=80)

        self.status = {"state": "training", "progress": 80, "message": "Training final model with best params...", "metrics": {}}

        model, metrics = train_lgbm(X_train, y_train, X_val, y_val, params=best_params)
        metrics["best_params"] = best_params

        if self._selected_feature_names and len(self._selected_feature_names) == X.shape[1]:
            feature_names = self._selected_feature_names
        else:
            feature_names = self.extractor.get_feature_names(
                fetch_candles(instruments[0], granularities[0], start_dt, end_dt).head(300)
            )
        if len(feature_names) == X.shape[1]:
            metrics["top_features"] = [
                (feature_names[int(f[1:])], imp) for f, imp in metrics["top_features"]
            ]

        meta = {
            "feature_count": X.shape[1],
            "model_type": "lgbm",
            "instruments": instruments,
            "granularities": granularities,
            "horizon": horizon,
            "min_atr_move": min_atr_move,
            "train_samples": int(len(X_train)),
            "val_samples": int(len(X_val)),
            "val_accuracy": metrics["val_accuracy"],
            "train_accuracy": metrics["train_accuracy"],
        }

        self.status = {"state": "saving", "progress": 90, "message": "Saving model...", "metrics": {}}
        path = save_lgbm_model(model, "universal-lgbm", version, meta)

        metrics["model_path"] = path
        self.status = {"state": "complete", "progress": 100, "message": "Training complete", "metrics": metrics}
        return self.status
