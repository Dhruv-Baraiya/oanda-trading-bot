import time
import numpy as np
import pandas as pd
from fastapi import APIRouter
from pydantic import BaseModel
from app.models.universal import load_universal_model
from app.models.specialist import load_specialist_model
from app.features.extractor import FeatureExtractor
from app.meta.controller import MetaController

router = APIRouter()
extractor = FeatureExtractor(lookback=60)
meta = MetaController()

_universal_model = None
_specialist_models: dict = {}


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

    universal = get_universal()
    specialist = get_specialist(req.instrument)

    if universal is None:
        return {
            "universal": None,
            "specialist": None,
            "meta": meta.decide(
                rule_direction=req.rule_signal.get("direction") if req.rule_signal else None,
                universal_probs=None,
            ),
            "message": "No trained model found. Train first via POST /train",
        }

    h1 = _candles_to_df(req.candles_h1)
    m1 = _candles_to_df(req.candles_m1) if req.candles_m1 else None
    m15 = _candles_to_df(req.candles_m15) if req.candles_m15 else None
    h4 = _candles_to_df(req.candles_h4) if req.candles_h4 else None

    features = extractor.extract(h1, m1, m15, h4)

    if len(features) == 0:
        return {"error": "Not enough candle data for prediction (need 60+ H1 candles)"}

    # Use last window
    X = features[-1:].astype(np.float32)

    # Universal prediction
    uni_start = time.time()
    dir_probs, magnitude = universal.predict(X, verbose=0)
    uni_time = int((time.time() - uni_start) * 1000)

    direction_map = {0: "UP", 1: "DOWN", 2: "FLAT"}
    pred_dir = direction_map[int(np.argmax(dir_probs[0]))]

    universal_result = {
        "direction": pred_dir,
        "direction_probabilities": {
            "UP": round(float(dir_probs[0][0]), 4),
            "DOWN": round(float(dir_probs[0][1]), 4),
            "FLAT": round(float(dir_probs[0][2]), 4),
        },
        "magnitude_pips": round(float(magnitude[0][0]) * 10000, 1),
        "inference_time_ms": uni_time,
    }

    # Specialist prediction
    specialist_result = None
    spec_conf = None
    spec_size = None
    if specialist is not None:
        spec_start = time.time()
        conf, size = specialist.predict(X, verbose=0)
        spec_time = int((time.time() - spec_start) * 1000)
        spec_conf = float(conf[0][0])
        spec_size = float(size[0][0])
        specialist_result = {
            "signal_confidence": round(spec_conf, 4),
            "size_multiplier": round(max(0.5, min(2.0, spec_size)), 4),
            "inference_time_ms": spec_time,
        }

    # Meta decision
    rule_dir = req.rule_signal.get("direction") if req.rule_signal else None
    meta_result = meta.decide(
        rule_direction=rule_dir,
        universal_probs=[
            universal_result["direction_probabilities"]["UP"],
            universal_result["direction_probabilities"]["DOWN"],
            universal_result["direction_probabilities"]["FLAT"],
        ],
        specialist_confidence=spec_conf,
        specialist_size=spec_size,
    )

    total_time = int((time.time() - start) * 1000)

    return {
        "universal": universal_result,
        "specialist": specialist_result,
        "meta": meta_result,
        "inference_time_ms": total_time,
    }
