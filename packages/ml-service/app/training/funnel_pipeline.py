import numpy as np
import pandas as pd
from datetime import datetime
from app.data.fetcher import fetch_candles
from app.features.flat_extractor import FlatFeatureExtractor
from app.features.regime import classify_regime, regime_label, REGIME_TRENDING, REGIME_RANGING, REGIME_CHOPPY
from app.training.labels import generate_direction_labels
from app.models.lgbm_model import train_lgbm, save_lgbm_model, tune_lgbm


class FunnelPipeline:
    def __init__(self):
        self.extractor = FlatFeatureExtractor()
        self.status = {"state": "idle", "progress": 0, "message": "", "metrics": {}}

    def train_funnel(
        self,
        instruments: list[str] = None,
        granularities: list[str] = None,
        train_start: str = "2019-01-01",
        train_end: str = "2025-12-31",
        val_end: str = "2026-12-31",
        version: str = "v1",
        horizon: int = 12,
        min_atr_move: float = 0.5,
        n_trials: int = 50,
    ) -> dict:
        if instruments is None:
            instruments = ["EUR_USD"]
        if granularities is None:
            granularities = ["H1"]

        horizons = {"H1": horizon, "M15": 16, "H4": 3}
        start_dt = datetime.fromisoformat(train_start)
        end_dt = datetime.fromisoformat(val_end)

        print("[Funnel] Stage 1: Loading data + regime classification...")
        all_X, all_y, all_dates, all_regimes = [], [], [], []

        for instrument in instruments:
            for gran in granularities:
                print(f"[Funnel] Fetching {instrument}/{gran}...")
                df = fetch_candles(instrument, gran, start_dt, end_dt)
                if len(df) < 500:
                    continue

                h = horizons.get(gran, horizon)
                features = self.extractor.extract(df)
                directions, magnitudes, valid_mask = generate_direction_labels(
                    df, horizon=h, min_atr_move=min_atr_move
                )
                regimes = classify_regime(df)

                n = min(len(features), len(directions))
                features = features.iloc[:n]
                directions = directions[:n]
                valid = valid_mask[:n]
                regimes = regimes[:n]

                X = features.values[valid]
                y = directions[valid]
                dates = features.index[:n][valid]
                r = regimes[valid]

                print(f"[Funnel] {instrument}/{gran}: {len(X)} valid samples")
                all_X.append(X)
                all_y.append(y)
                all_dates.append(dates)
                all_regimes.append(r)

        if not all_X:
            self.status = {"state": "error", "message": "No data"}
            return self.status

        X = np.vstack(all_X)
        y = np.concatenate(all_y)
        dates = np.concatenate(all_dates)
        regimes = np.concatenate(all_regimes)

        n_trend = (regimes == REGIME_TRENDING).sum()
        n_range = (regimes == REGIME_RANGING).sum()
        n_chop = (regimes == REGIME_CHOPPY).sum()
        print(f"[Funnel] Total: {len(X)} samples, {X.shape[1]} features")
        print(f"[Funnel] Regimes: trending={n_trend} ({n_trend/len(X)*100:.1f}%), "
              f"ranging={n_range} ({n_range/len(X)*100:.1f}%), "
              f"choppy={n_chop} ({n_chop/len(X)*100:.1f}%)")

        train_end_dt = pd.Timestamp(train_end)
        train_mask = dates <= train_end_dt
        val_mask = ~train_mask

        if val_mask.sum() < 100:
            split_idx = int(len(X) * 0.8)
            train_mask = np.zeros(len(X), dtype=bool)
            train_mask[:split_idx] = True
            val_mask = ~train_mask

        results = {}

        for regime_code, regime_name in [(REGIME_TRENDING, "trending"), (REGIME_RANGING, "ranging")]:
            r_mask = regimes == regime_code
            r_train = train_mask & r_mask
            r_val = val_mask & r_mask

            if r_train.sum() < 500 or r_val.sum() < 100:
                print(f"[Funnel] Skipping {regime_name} — too few samples "
                      f"(train={r_train.sum()}, val={r_val.sum()})")
                continue

            X_train, X_val = X[r_train], X[r_val]
            y_train, y_val = y[r_train], y[r_val]

            up = y_train.sum()
            print(f"\n[Funnel] === Training {regime_name} model ===")
            print(f"[Funnel] Train: {len(X_train)} (UP={up:.0f}, DOWN={len(y_train)-up:.0f})")
            print(f"[Funnel] Val: {len(X_val)}")

            print(f"[Funnel] Tuning {regime_name} ({n_trials} trials)...")
            best_params = tune_lgbm(X_train, y_train, X_val, y_val, n_trials=n_trials)

            print(f"[Funnel] Training final {regime_name} model...")
            model, metrics = train_lgbm(X_train, y_train, X_val, y_val, params=best_params)
            metrics["best_params"] = best_params
            metrics["regime"] = regime_name

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
                "regime": regime_name,
                "instruments": instruments,
                "granularities": granularities,
                "horizon": horizon,
                "min_atr_move": min_atr_move,
                "train_samples": int(len(X_train)),
                "val_samples": int(len(X_val)),
                "val_accuracy": metrics["val_accuracy"],
                "train_accuracy": metrics["train_accuracy"],
            }

            model_name = f"funnel-{regime_name}"
            save_lgbm_model(model, model_name, version, meta)
            results[regime_name] = metrics
            print(f"[Funnel] {regime_name}: train={metrics['train_accuracy']:.4f}, "
                  f"val={metrics['val_accuracy']:.4f}")

        # Also train universal model on all non-choppy data as fallback
        non_choppy = regimes != REGIME_CHOPPY
        nc_train = train_mask & non_choppy
        nc_val = val_mask & non_choppy

        if nc_train.sum() > 500 and nc_val.sum() > 100:
            X_train, X_val = X[nc_train], X[nc_val]
            y_train, y_val = y[nc_train], y[nc_val]

            print(f"\n[Funnel] === Training combined (non-choppy) model ===")
            print(f"[Funnel] Train: {len(X_train)}, Val: {len(X_val)}")
            print(f"[Funnel] Tuning combined ({n_trials} trials)...")

            best_params = tune_lgbm(X_train, y_train, X_val, y_val, n_trials=n_trials)
            model, metrics = train_lgbm(X_train, y_train, X_val, y_val, params=best_params)
            metrics["best_params"] = best_params
            metrics["regime"] = "combined"

            if len(feature_names) == X.shape[1]:
                metrics["top_features"] = [
                    (feature_names[int(f[1:])], imp) for f, imp in metrics["top_features"]
                ]

            meta = {
                "feature_count": X.shape[1],
                "model_type": "lgbm",
                "regime": "combined_no_choppy",
                "instruments": instruments,
                "granularities": granularities,
                "horizon": horizon,
                "min_atr_move": min_atr_move,
                "train_samples": int(len(X_train)),
                "val_samples": int(len(X_val)),
                "val_accuracy": metrics["val_accuracy"],
                "train_accuracy": metrics["train_accuracy"],
            }
            save_lgbm_model(model, "funnel-combined", version, meta)
            results["combined"] = metrics
            print(f"[Funnel] combined: train={metrics['train_accuracy']:.4f}, "
                  f"val={metrics['val_accuracy']:.4f}")

        # Compare with v4 baseline
        print(f"\n[Funnel] === Results Summary ===")
        print(f"[Funnel] v4 baseline: val_accuracy=0.5293")
        for name, m in results.items():
            print(f"[Funnel] {name}: val_accuracy={m['val_accuracy']:.4f}")

        self.status = {
            "state": "complete",
            "progress": 100,
            "message": "Funnel training complete",
            "metrics": results,
        }
        return self.status
