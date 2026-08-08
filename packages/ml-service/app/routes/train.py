import threading
from fastapi import APIRouter
from pydantic import BaseModel
from app.training.pipeline import TrainingPipeline

router = APIRouter()

_pipeline = TrainingPipeline()
_training_thread = None


class TrainRequest(BaseModel):
    instrument: str = "EUR_USD"
    train_start: str = "2019-01-01"
    train_end: str = "2025-12-31"
    val_start: str = "2026-01-01"
    val_end: str = "2026-12-31"
    version: str = "v1"


@router.post("/train")
def start_training(req: TrainRequest):
    import os
    if os.getenv("INFERENCE_ONLY") == "1":
        return {"error": "Training disabled on this instance (INFERENCE_ONLY=1). Train locally and weights sync via MongoDB."}

    global _training_thread, _pipeline

    if _pipeline.get_status()["state"] == "training":
        return {"error": "Training already in progress", "status": _pipeline.get_status()}

    _pipeline = TrainingPipeline(instrument=req.instrument)

    def run():
        _pipeline.train_universal(
            train_start=req.train_start,
            train_end=req.train_end,
            val_start=req.val_start,
            val_end=req.val_end,
            version=req.version,
        )

    _training_thread = threading.Thread(target=run, daemon=True)
    _training_thread.start()

    return {"started": True, "status": _pipeline.get_status()}


@router.get("/model/status")
def training_status():
    return _pipeline.get_status()
