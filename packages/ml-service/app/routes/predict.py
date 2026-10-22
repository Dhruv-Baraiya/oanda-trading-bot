import time
import numpy as np
import pandas as pd
from fastapi import APIRouter
from pydantic import BaseModel
from app.models.universal import load_universal_model
from app.models.specialist import load_specialist_model
from app.models.lgbm_model import load_lgbm_model
from app.models.question_predictor import QuestionEnsemblePredictor
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
_question_ensemble = None


def get_question_ensemble():
    global _question_ensemble
    if _question_ensemble is None:
        _question_ensemble = QuestionEnsemblePredictor("latest")
    return _question_ensemble


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

    h1 = _candles_to_df(req.candles_h1)
    rule_dir = req.rule_signal.get("direction") if req.rule_signal else None

    # Primary: Question Ensemble (regime filter + 3 sub-models + bench)
    qe = get_question_ensemble()
    ensemble_result = None

    if qe.is_loaded and len(h1) >= 200:
        qe_start = time.time()
        qe_result = qe.predict(
            h1,
            instrument=req.instrument,
            granularity="H1",
            confidence_threshold=0.53,
            require_unanimous=True,
        )
        qe_time = int((time.time() - qe_start) * 1000)

        ensemble_result = {
            "trade": qe_result["trade"],
            "reason": qe_result["reason"],
            "regime": qe_result.get("regime", "unknown"),
            "direction": qe_result.get("direction"),
            "confidence": qe_result.get("avg_confidence", 0),
            "unanimous": qe_result.get("unanimous", False),
            "size_factor": qe_result.get("size_factor", 1.0),
            "votes": qe_result.get("votes"),
            "answers": qe_result.get("answers"),
            "inference_time_ms": qe_time,
            "model_type": "question_ensemble",
        }

        if qe_result["trade"]:
            up_prob = 0.5
            if qe_result["direction"] == "BUY":
                up_prob = max(a["up_prob"] for a in qe_result["answers"].values())
            else:
                up_prob = min(a["up_prob"] for a in qe_result["answers"].values())
        else:
            up_prob = 0.5
    else:
        up_prob = 0.5

    # Fallback: LightGBM universal (always runs for comparison)
    lgbm = get_lgbm()
    if lgbm is not None:
        uni_start = time.time()
        features = flat_extractor.extract(h1)
        if len(features) >= 1:
            X = features.iloc[[-1]].values.astype(np.float32)
            expected = lgbm.n_features_in_
            if X.shape[1] < expected:
                X = np.pad(X, ((0, 0), (0, expected - X.shape[1])), mode='constant')
            elif X.shape[1] > expected:
                X = X[:, :expected]

            lgbm_up_prob = float(lgbm.predict_proba(X)[0][1])
            uni_time = int((time.time() - uni_start) * 1000)

            if not qe.is_loaded or len(h1) < 200:
                up_prob = lgbm_up_prob
        else:
            lgbm_up_prob = 0.5
            uni_time = 0
    else:
        lgbm_up_prob = 0.5
        uni_time = 0

    pred_dir = "UP" if up_prob > 0.5 else "DOWN"
    confidence = abs(up_prob - 0.5) * 2

    universal_result = {
        "direction": pred_dir,
        "confidence": round(confidence, 4),
        "direction_probabilities": {"UP": round(up_prob, 4), "DOWN": round(1 - up_prob, 4)},
        "model_type": "question_ensemble" if ensemble_result and ensemble_result["trade"] else "lgbm",
        "inference_time_ms": uni_time,
    }

    # Override direction/confidence from ensemble when it trades
    if ensemble_result and ensemble_result["trade"]:
        universal_result["direction"] = ensemble_result["direction"].replace("BUY", "UP").replace("SELL", "DOWN")
        universal_result["confidence"] = round(ensemble_result["confidence"], 4)
        universal_result["model_type"] = "question_ensemble"

    specialist_result = None
    spec_conf = None
    spec_size = None

    # Use ensemble size_factor as specialist equivalent
    if ensemble_result and ensemble_result["trade"]:
        spec_conf = ensemble_result["confidence"]
        spec_size = ensemble_result["size_factor"]
        specialist_result = {
            "signal_confidence": round(spec_conf, 4),
            "size_multiplier": round(max(0.5, min(2.0, spec_size)), 4),
            "inference_time_ms": ensemble_result.get("inference_time_ms", 0),
        }
    else:
        specialist = get_specialist(req.instrument)
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

    # Add ensemble skip info to meta when not trading
    if ensemble_result and not ensemble_result["trade"]:
        meta_result["ensemble_skip"] = {
            "reason": ensemble_result["reason"],
            "regime": ensemble_result["regime"],
        }

    return {
        "universal": universal_result,
        "specialist": specialist_result,
        "ensemble": ensemble_result,
        "meta": meta_result,
        "inference_time_ms": int((time.time() - start) * 1000),
    }
