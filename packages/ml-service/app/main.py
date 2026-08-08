from fastapi import FastAPI
from app.routes.predict import router as predict_router, get_universal
from app.routes.train import router as train_router

app = FastAPI(title="Trading ML Service", version="0.1.0")

app.include_router(predict_router)
app.include_router(train_router)


@app.on_event("startup")
def load_models():
    model = get_universal()
    if model:
        print(f"[ML] Universal model loaded")
    else:
        print("[ML] No universal model found — train first via POST /train")


@app.get("/health")
def health():
    model = get_universal()
    return {
        "status": "ok",
        "model_loaded": model is not None,
    }
