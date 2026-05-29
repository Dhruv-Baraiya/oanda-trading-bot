from fastapi import FastAPI

app = FastAPI(title="Trading ML Service", version="0.1.0")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/predict")
def predict():
    return {"direction": "FLAT", "confidence": 0.0, "message": "Model not trained yet"}
