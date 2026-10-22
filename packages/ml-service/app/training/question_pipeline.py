import numpy as np
import pandas as pd
from datetime import datetime
from app.data.fetcher import fetch_candles
from app.features.flat_extractor import FlatFeatureExtractor
from app.features.regime import classify_regime, REGIME_CHOPPY
from app.features.question_groups import QUESTION_GROUPS, get_feature_indices
from app.training.labels import generate_direction_labels
from app.models.lgbm_model import train_lgbm, save_lgbm_model, tune_lgbm


class QuestionPipeline:
    def __init__(self):
        self.extractor = FlatFeatureExtractor()

    def train_questions(
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

        print("[QE] Loading data + regime classification...")
        all_X, all_y, all_dates, all_regimes = [], [], [], []

        for instrument in instruments:
            for gran in granularities:
                print(f"[QE] Fetching {instrument}/{gran}...")
                df = fetch_candles(instrument, gran, start_dt, end_dt)
                if len(df) < 500:
                    continue

                h = horizons.get(gran, horizon)
                features = self.extractor.extract(df)
                directions, _, valid_mask = generate_direction_labels(
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

                print(f"[QE] {instrument}/{gran}: {len(X)} samples")
                all_X.append(X)
                all_y.append(y)
                all_dates.append(dates)
                all_regimes.append(r)

        X = np.vstack(all_X)
        y = np.concatenate(all_y)
        dates = np.concatenate(all_dates)
        regimes = np.concatenate(all_regimes)

        non_choppy = regimes != REGIME_CHOPPY
        X = X[non_choppy]
        y = y[non_choppy]
        dates = dates[non_choppy]

        print(f"[QE] Non-choppy samples: {len(X)}, features: {X.shape[1]}")

        all_feature_names = self.extractor.get_feature_names(
            fetch_candles(instruments[0], granularities[0], start_dt, end_dt).head(300)
        )

        train_end_dt = pd.Timestamp(train_end)
        train_mask = dates <= train_end_dt
        val_mask = ~train_mask

        if val_mask.sum() < 100:
            split_idx = int(len(X) * 0.8)
            train_mask = np.zeros(len(X), dtype=bool)
            train_mask[:split_idx] = True
            val_mask = ~train_mask

        print(f"[QE] Train: {train_mask.sum()}, Val: {val_mask.sum()}")

        results = {}

        for q_name, q_features in QUESTION_GROUPS.items():
            indices = get_feature_indices(all_feature_names, q_features)
            if len(indices) < 5:
                print(f"[QE] Skipping {q_name} — only {len(indices)} features matched")
                continue

            X_q = X[:, indices]
            X_train, X_val = X_q[train_mask], X_q[val_mask]
            y_train, y_val = y[train_mask], y[val_mask]

            print(f"\n[QE] === Training {q_name} model ({len(indices)} features) ===")
            matched = [all_feature_names[i] for i in indices]
            print(f"[QE] Features: {matched[:8]}...")
            print(f"[QE] Train: {len(X_train)}, Val: {len(X_val)}")

            print(f"[QE] Tuning {q_name} ({n_trials} trials)...")
            best_params = tune_lgbm(X_train, y_train, X_val, y_val, n_trials=n_trials)

            print(f"[QE] Training final {q_name} model...")
            model, metrics = train_lgbm(X_train, y_train, X_val, y_val, params=best_params)
            metrics["best_params"] = best_params
            metrics["question"] = q_name
            metrics["feature_names"] = matched

            meta = {
                "feature_count": len(indices),
                "feature_indices": indices,
                "feature_names": matched,
                "model_type": "lgbm",
                "question": q_name,
                "instruments": instruments,
                "granularities": granularities,
                "horizon": horizon,
                "min_atr_move": min_atr_move,
                "train_samples": int(len(X_train)),
                "val_samples": int(len(X_val)),
                "val_accuracy": metrics["val_accuracy"],
                "train_accuracy": metrics["train_accuracy"],
            }

            save_lgbm_model(model, f"question-{q_name}", version, meta)
            results[q_name] = metrics
            print(f"[QE] {q_name}: train={metrics['train_accuracy']:.4f}, "
                  f"val={metrics['val_accuracy']:.4f}")

        # Ensemble evaluation: majority vote on val set
        if len(results) == 3:
            print(f"\n[QE] === Ensemble Evaluation (majority vote) ===")
            preds = {}
            for q_name in QUESTION_GROUPS:
                indices = get_feature_indices(all_feature_names, QUESTION_GROUPS[q_name])
                X_val_q = X[val_mask][:, indices]
                from app.models.lgbm_model import load_lgbm_model
                m = load_lgbm_model(f"question-{q_name}", version)
                if m:
                    proba = m.predict_proba(X_val_q)[:, 1]
                    preds[q_name] = proba

            if len(preds) == 3:
                y_val = y[val_mask]
                votes = np.zeros(len(y_val))
                for proba in preds.values():
                    votes += (proba > 0.5).astype(float)

                # Majority vote (2/3 or 3/3 agree)
                ensemble_pred = (votes >= 2).astype(int)
                ensemble_acc = np.mean(ensemble_pred == y_val)
                print(f"[QE] Majority vote (all): accuracy={ensemble_acc:.4f}")

                # High confidence: all 3 agree
                unanimous = (votes == 3) | (votes == 0)
                if unanimous.sum() > 100:
                    unan_acc = np.mean(ensemble_pred[unanimous] == y_val[unanimous])
                    print(f"[QE] Unanimous (3/3 agree): accuracy={unan_acc:.4f} "
                          f"({unanimous.sum()}/{len(y_val)} = {unanimous.sum()/len(y_val)*100:.1f}% of signals)")

                # Confidence-gated: only where max proba > threshold
                for thresh in [0.55, 0.58, 0.60]:
                    max_conf = np.max(list(preds.values()), axis=0)
                    gate = max_conf > thresh
                    if gate.sum() > 100:
                        gated_acc = np.mean(ensemble_pred[gate] == y_val[gate])
                        print(f"[QE] Conf>{thresh}: accuracy={gated_acc:.4f} "
                              f"({gate.sum()}/{len(y_val)} = {gate.sum()/len(y_val)*100:.1f}%)")

                results["ensemble"] = {
                    "majority_vote_accuracy": float(ensemble_acc),
                    "unanimous_count": int(unanimous.sum()),
                    "total_val": int(len(y_val)),
                }

        print(f"\n[QE] === Final Results ===")
        print(f"[QE] v4 baseline: 0.5293")
        print(f"[QE] Funnel trending: 0.5377")
        for name, m in results.items():
            if isinstance(m, dict) and "val_accuracy" in m:
                print(f"[QE] {name}: {m['val_accuracy']:.4f}")
            elif isinstance(m, dict) and "majority_vote_accuracy" in m:
                print(f"[QE] ensemble majority: {m['majority_vote_accuracy']:.4f}")

        return results
