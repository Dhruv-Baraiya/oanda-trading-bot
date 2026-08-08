from fastapi import FastAPI
from app.routes.predict import router as predict_router, get_universal, get_specialist
from app.routes.train import router as train_router

app = FastAPI(title="Trading ML Service", version="0.1.0")

app.include_router(predict_router)
app.include_router(train_router)

PRELOAD_INSTRUMENTS = ["EUR_USD"]


@app.on_event("startup")
def load_models():
    model = get_universal()
    if model:
        print("[ML] Universal model loaded")
    else:
        print("[ML] No universal model found — train first via POST /train")

    for inst in PRELOAD_INSTRUMENTS:
        spec = get_specialist(inst)
        if spec:
            print(f"[ML] Specialist model loaded: {inst}")
        else:
            print(f"[ML] No specialist model for {inst} — train via POST /train/specialist")


@app.get("/health")
def health():
    model = get_universal()
    specialists = {inst: get_specialist(inst) is not None for inst in PRELOAD_INSTRUMENTS}
    return {
        "status": "ok",
        "model_loaded": model is not None,
        "specialist_loaded": specialists,
    }
