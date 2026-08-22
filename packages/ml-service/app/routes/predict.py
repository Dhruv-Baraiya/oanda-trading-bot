import time
import numpy as np
import pandas as pd
from fastapi import APIRouter
from pydantic import BaseModel
from app.models.universal import load_universal_model
from app.models.specialist import load_specialist_model
from app.models.lgbm_model import load_lgbm_model
from app.features.extractor import FeatureExtractor
from app.features.flat_extractor import FlatFeatureExtractor
from app.meta.controller import MetaController

router = APIRouter()
lstm_extractor = FeatureExtractor(lookback=20)
flat_extractor = FlatFeatureExtractor()
meta = MetaController()

_lgbm_model = None
_universal_model = None
_specialist_models: dict = {}


def get_lgbm():
    global _lgbm_model
    if _lgbm_model is None:
        _lgbm_model = load_lgbm_model("universal-lgbm", "latest")
    return _lgbm_model


def get_universal():
    global _universal_model
    if _universal_model is None:
        _universal_model = load_universal_model("latest")
    return _universal_model


def get_specialist(instrument: str):
    if instrument not in _specialist_models:
        _specialist_models[instrument] = load_specialist_model(instrument, "latest")
    return _specialist_models[instrument]


class CandleData(BaseModel):
    t: str
    o: float
    h: float
    l: float
    c: float
    v: int


class PredictRequest(BaseModel):
    instrument: str
    candles_h1: list[CandleData]
    candles_m1: list[CandleData] | None = None
    candles_m15: list[CandleData] | None = None
    candles_h4: list[CandleData] | None = None
    indicators: dict | None = None
    sentiment: dict | None = None
    rule_signal: dict | None = None


def _candles_to_df(candles: list[CandleData]) -> pd.DataFrame:
    records = [{"timestamp": c.t, "open": c.o, "high": c.h, "low": c.l, "close": c.c, "volume": c.v} for c in candles]
    df = pd.DataFrame(records)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df.set_index("timestamp").sort_index()
    return df


@router.post("/predict")
def predict(req: PredictRequest):
    start = time.time()

    lgbm = get_lgbm()
    specialist = get_specialist(req.instrument)

    h1 = _candles_to_df(req.candles_h1)
    rule_dir = req.rule_signal.get("direction") if req.rule_signal else None

    # Primary: LightGBM (if available)
    if lgbm is not None:
        uni_start = time.time()
        features = flat_extractor.extract(h1)
        if len(features) < 1:
            return {"error": "Not enough candle data"}

        X = features.iloc[[-1]].values.astype(np.float32)
        expected = lgbm.n_features_in_
        if X.shape[1] < expected:
            X = np.pad(X, ((0, 0), (0, expected - X.shape[1])), mode='constant')
        elif X.shape[1] > expected:
            X = X[:, :expected]

        up_prob = float(lgbm.predict_proba(X)[0][1])
        uni_time = int((time.time() - uni_start) * 1000)
    else:
        # Fallback: LSTM
        universal = get_universal()
        if universal is None:
            return {
                "universal": None, "specialist": None,
                "meta": meta.decide(rule_direction=rule_dir, universal_probs=None),
                "message": "No trained model found",
            }

        m1 = _candles_to_df(req.candles_m1) if req.candles_m1 else None
        m15 = _candles_to_df(req.candles_m15) if req.candles_m15 else None
        h4 = _candles_to_df(req.candles_h4) if req.candles_h4 else None
        features = lstm_extractor.extract(h1, m1, m15, h4)

        if len(features) == 0:
            return {"error": "Not enough candle data for prediction"}

        X = features[-1:].astype(np.float32)
        expected = universal.input_shape[2]
        if X.shape[2] < expected:
            X = np.pad(X, ((0, 0), (0, 0), (0, expected - X.shape[2])), mode='constant')
        elif X.shape[2] > expected:
            X = X[:, :, :expected]

        uni_start = time.time()
        dir_probs, magnitude = universal.predict(X, verbose=0)
        up_prob = float(dir_probs[0][0])
        uni_time = int((time.time() - uni_start) * 1000)

    pred_dir = "UP" if up_prob > 0.5 else "DOWN"
    confidence = abs(up_prob - 0.5) * 2

    universal_result = {
        "direction": pred_dir,
        "confidence": round(confidence, 4),
        "direction_probabilities": {"UP": round(up_prob, 4), "DOWN": round(1 - up_prob, 4)},
        "model_type": "lgbm" if lgbm is not None else "lstm",
        "inference_time_ms": uni_time,
    }

    # Specialist prediction
    specialist_result = None
    spec_conf = None
    spec_size = None
    if specialist is not None:
        spec_start = time.time()
        spec_features = lstm_extractor.extract(h1, None, None, None)
        if len(spec_features) > 0:
            X_spec = spec_features[-1:].astype(np.float32)
            sf = specialist.input_shape[2]
            if X_spec.shape[2] < sf:
                X_spec = np.pad(X_spec, ((0, 0), (0, 0), (0, sf - X_spec.shape[2])), mode='constant')
            elif X_spec.shape[2] > sf:
                X_spec = X_spec[:, :, :sf]
            conf, size = specialist.predict(X_spec, verbose=0)
            spec_time = int((time.time() - spec_start) * 1000)
            spec_conf = float(conf[0][0])
            spec_size = float(size[0][0])
            specialist_result = {
                "signal_confidence": round(spec_conf, 4),
                "size_multiplier": round(max(0.5, min(2.0, spec_size)), 4),
                "inference_time_ms": spec_time,
            }

    meta_result = meta.decide(
        rule_direction=rule_dir,
        universal_probs=[universal_result["direction_probabilities"]["UP"]],
        specialist_confidence=spec_conf,
        specialist_size=spec_size,
    )

    return {
        "universal": universal_result,
        "specialist": specialist_result,
        "meta": meta_result,
        "inference_time_ms": int((time.time() - start) * 1000),
    }
