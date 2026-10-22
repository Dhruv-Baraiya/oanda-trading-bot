import numpy as np
import pandas as pd
from app.features.flat_extractor import FlatFeatureExtractor
from app.features.regime import classify_regime, REGIME_CHOPPY, regime_label
from app.features.question_groups import QUESTION_GROUPS, get_feature_indices
from app.models.lgbm_model import load_lgbm_model
from app.models.bench import is_benched, sit


class QuestionEnsemblePredictor:
    def __init__(self, version: str = "latest"):
        self.extractor = FlatFeatureExtractor()
        self.models = {}
        self.feature_indices = {}
        self._all_feature_names = None

        for q_name in QUESTION_GROUPS:
            m = load_lgbm_model(f"question-{q_name}", version)
            if m:
                self.models[q_name] = m

        self._loaded = len(self.models) == 3

    def _ensure_indices(self, df: pd.DataFrame):
        if self._all_feature_names is None:
            self._all_feature_names = self.extractor.get_feature_names(df.head(300))
            for q_name, q_features in QUESTION_GROUPS.items():
                self.feature_indices[q_name] = get_feature_indices(
                    self._all_feature_names, q_features
                )

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    def predict(
        self,
        df: pd.DataFrame,
        instrument: str = "",
        granularity: str = "",
        confidence_threshold: float = 0.55,
        require_unanimous: bool = False,
    ) -> dict:
        if not self._loaded:
            return {"trade": False, "reason": "no_models"}

        benched = is_benched(instrument, granularity)
        if benched:
            return {
                "trade": False,
                "reason": f"benched:{benched['reason']}",
                "minutes_left": benched["minutes_left"],
            }

        regime_arr = classify_regime(df)
        current_regime = regime_arr[-1]

        if current_regime == REGIME_CHOPPY:
            sit(instrument, granularity, "choppy_regime")
            return {
                "trade": False,
                "reason": "choppy_regime",
                "regime": "choppy",
            }

        self._ensure_indices(df)
        features = self.extractor.extract(df)
        X_full = features.iloc[[-1]].values
        X_full = np.nan_to_num(X_full, nan=0.0, posinf=0.0, neginf=0.0)

        answers = {}
        for q_name, model in self.models.items():
            idx = self.feature_indices[q_name]
            X_q = X_full[:, idx]
            proba = model.predict_proba(X_q)[0]
            answers[q_name] = {
                "up_prob": float(proba[1]),
                "direction": "BUY" if proba[1] > 0.5 else "SELL",
                "confidence": float(max(proba[0], proba[1])),
            }

        directions = [a["direction"] for a in answers.values()]
        buy_votes = sum(1 for d in directions if d == "BUY")
        sell_votes = 3 - buy_votes

        unanimous = buy_votes == 3 or sell_votes == 3
        majority = buy_votes >= 2 or sell_votes >= 2
        direction = "BUY" if buy_votes >= 2 else "SELL"

        if require_unanimous and not unanimous:
            sit(instrument, granularity, "question_disagreement")
            return {
                "trade": False,
                "reason": "question_disagreement",
                "regime": regime_label(current_regime),
                "answers": answers,
                "votes": {"BUY": buy_votes, "SELL": sell_votes},
            }

        if not majority:
            sit(instrument, granularity, "question_disagreement")
            return {
                "trade": False,
                "reason": "question_disagreement",
                "regime": regime_label(current_regime),
                "answers": answers,
            }

        avg_confidence = np.mean([a["confidence"] for a in answers.values()])
        max_confidence = max(a["confidence"] for a in answers.values())

        if avg_confidence < confidence_threshold:
            sit(instrument, granularity, "low_confidence")
            return {
                "trade": False,
                "reason": "low_confidence",
                "regime": regime_label(current_regime),
                "direction": direction,
                "avg_confidence": float(avg_confidence),
                "answers": answers,
            }

        size_factor = 1.0
        if not unanimous:
            size_factor *= 0.7
        if avg_confidence < 0.58:
            size_factor *= 0.8

        return {
            "trade": True,
            "reason": "all_stages_passed",
            "regime": regime_label(current_regime),
            "direction": direction,
            "avg_confidence": float(avg_confidence),
            "max_confidence": float(max_confidence),
            "unanimous": unanimous,
            "size_factor": float(size_factor),
            "votes": {"BUY": buy_votes, "SELL": sell_votes},
            "answers": answers,
        }
