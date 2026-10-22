import numpy as np
import pandas as pd
from app.features.flat_extractor import FlatFeatureExtractor
from app.features.regime import classify_regime, REGIME_TRENDING, REGIME_RANGING, REGIME_CHOPPY, regime_label
from app.models.lgbm_model import load_lgbm_model


class FunnelPredictor:
    def __init__(self, version: str = "latest"):
        self.extractor = FlatFeatureExtractor()
        self.trending_model = load_lgbm_model("funnel-trending", version)
        self.ranging_model = load_lgbm_model("funnel-ranging", version)
        self.combined_model = load_lgbm_model("funnel-combined", version)
        self._loaded = any([self.trending_model, self.ranging_model, self.combined_model])

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    def predict(
        self,
        df: pd.DataFrame,
        confidence_threshold: float = 0.55,
        require_mtf_agreement: bool = False,
        mtf_df: pd.DataFrame = None,
    ) -> dict:
        """Run the full funnel on the latest candle in df.
        Returns dict with direction, confidence, regime, and whether to trade."""

        if not self._loaded:
            return {"trade": False, "reason": "no_model", "regime": "unknown"}

        regime_arr = classify_regime(df)
        current_regime = regime_arr[-1]

        if current_regime == REGIME_CHOPPY:
            return {
                "trade": False,
                "reason": "choppy_regime",
                "regime": "choppy",
                "direction": None,
                "confidence": 0.0,
            }

        features = self.extractor.extract(df)
        X = features.iloc[[-1]].values
        X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)

        if current_regime == REGIME_TRENDING and self.trending_model:
            model = self.trending_model
            model_name = "trending"
        elif current_regime == REGIME_RANGING and self.ranging_model:
            model = self.ranging_model
            model_name = "ranging"
        elif self.combined_model:
            model = self.combined_model
            model_name = "combined"
        else:
            return {"trade": False, "reason": "no_model_for_regime", "regime": regime_label(current_regime)}

        proba = model.predict_proba(X)[0]
        direction = "BUY" if proba[1] > 0.5 else "SELL"
        confidence = max(proba[0], proba[1])

        if confidence < confidence_threshold:
            return {
                "trade": False,
                "reason": "low_confidence",
                "regime": regime_label(current_regime),
                "model": model_name,
                "direction": direction,
                "confidence": float(confidence),
            }

        if require_mtf_agreement and mtf_df is not None:
            mtf_regime = classify_regime(mtf_df)[-1]
            if mtf_regime == REGIME_CHOPPY:
                return {
                    "trade": False,
                    "reason": "mtf_choppy",
                    "regime": regime_label(current_regime),
                    "model": model_name,
                    "direction": direction,
                    "confidence": float(confidence),
                }

            mtf_features = self.extractor.extract(mtf_df)
            mtf_X = mtf_features.iloc[[-1]].values
            mtf_X = np.nan_to_num(mtf_X, nan=0.0, posinf=0.0, neginf=0.0)

            if mtf_regime == REGIME_TRENDING and self.trending_model:
                mtf_model = self.trending_model
            elif mtf_regime == REGIME_RANGING and self.ranging_model:
                mtf_model = self.ranging_model
            else:
                mtf_model = self.combined_model

            if mtf_model:
                mtf_proba = mtf_model.predict_proba(mtf_X)[0]
                mtf_dir = "BUY" if mtf_proba[1] > 0.5 else "SELL"
                if mtf_dir != direction:
                    return {
                        "trade": False,
                        "reason": "mtf_disagreement",
                        "regime": regime_label(current_regime),
                        "model": model_name,
                        "direction": direction,
                        "confidence": float(confidence),
                        "mtf_direction": mtf_dir,
                    }

        return {
            "trade": True,
            "reason": "all_stages_passed",
            "regime": regime_label(current_regime),
            "model": model_name,
            "direction": direction,
            "confidence": float(confidence),
        }
