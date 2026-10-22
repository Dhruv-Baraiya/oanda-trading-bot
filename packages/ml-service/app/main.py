from fastapi import FastAPI
from app.routes.predict import router as predict_router, get_universal, get_specialist, get_lgbm, get_question_ensemble
from app.routes.train import router as train_router

app = FastAPI(title="Trading ML Service", version="0.1.0")

app.include_router(predict_router)
app.include_router(train_router)

PRELOAD_INSTRUMENTS = ["EUR_USD"]


@app.on_event("startup")
def load_models():
    lgbm = get_lgbm()
    if lgbm:
        print(f"[ML] LightGBM model loaded ({lgbm.n_features_in_} features)")
    else:
        print("[ML] No LightGBM model — train via POST /train/lgbm")

    qe = get_question_ensemble()
    if qe.is_loaded:
        print(f"[ML] Question ensemble loaded (3 sub-models)")
    else:
        print("[ML] Question ensemble not loaded — train via POST /train/questions")

    model = get_universal()
    if model:
        print("[ML] Universal LSTM model loaded")

    for inst in PRELOAD_INSTRUMENTS:
        spec = get_specialist(inst)
        if spec:
            print(f"[ML] Specialist model loaded: {inst}")


@app.get("/health")
def health():
    lgbm = get_lgbm()
    qe = get_question_ensemble()
    model = get_universal()
    specialists = {inst: get_specialist(inst) is not None for inst in PRELOAD_INSTRUMENTS}
    return {
        "status": "ok",
        "lgbm_loaded": lgbm is not None,
        "question_ensemble_loaded": qe.is_loaded,
        "lstm_loaded": model is not None,
        "specialist_loaded": specialists,
    }
