import os
import tempfile
import numpy as np
from tensorflow import keras
from app.config import TRAINING_CONFIG, MODEL_DIR


def build_specialist_model(feature_count: int = 49, lookback: int = 60) -> keras.Model:
    cfg = TRAINING_CONFIG["specialist"]

    inputs = keras.Input(shape=(lookback, feature_count), name="candle_input")

    x = keras.layers.LSTM(cfg["lstm_layers"][0], return_sequences=True, dropout=cfg["dropout"])(inputs)
    x = keras.layers.LSTM(cfg["lstm_layers"][1], dropout=cfg["dropout"])(x)

    x = keras.layers.Dense(cfg["dense_units"], activation="relu")(x)

    confidence_out = keras.layers.Dense(1, activation="sigmoid", name="confidence")(x)
    size_out = keras.layers.Dense(1, activation="sigmoid", name="optimal_size")(x)

    model = keras.Model(inputs=inputs, outputs=[confidence_out, size_out])
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=0.001),
        loss={"confidence": "binary_crossentropy", "optimal_size": "mse"},
        loss_weights=cfg["loss_weights"],
        metrics={"confidence": "accuracy"},
    )

    return model


def load_specialist_model(instrument: str, version: str = "latest") -> keras.Model | None:
    path = os.path.join(MODEL_DIR, f"specialist-{instrument}-{version}.weights.h5")
    meta_path = os.path.join(MODEL_DIR, f"specialist-{instrument}-{version}.meta.npy")

    if os.path.exists(path) and os.path.exists(meta_path):
        meta = np.load(meta_path, allow_pickle=True).item()
        model = build_specialist_model(feature_count=meta["feature_count"], lookback=meta["lookback"])
        model.load_weights(path)
        return model

    return _load_from_mongo(instrument, version)


def _load_from_mongo(instrument: str, version: str) -> keras.Model | None:
    from app.data.mongo_client import get_collection

    try:
        doc = get_collection("ml_models").find_one({"name": f"specialist-{instrument}-{version}"})
        if not doc:
            print(f"[ML] specialist-{instrument}-{version} not found in MongoDB")
            return None

        meta = doc["meta"]
        print(f"[ML] Loading specialist-{instrument}-{version} from MongoDB (features={meta['feature_count']})")
        model = build_specialist_model(feature_count=meta["feature_count"], lookback=meta["lookback"])

        tmp = tempfile.NamedTemporaryFile(suffix=".weights.h5", delete=False)
        tmp.write(doc["weights"])
        tmp.close()
        model.load_weights(tmp.name)
        os.unlink(tmp.name)

        print(f"[ML] Loaded specialist-{instrument}-{version} from MongoDB")
        return model
    except Exception as e:
        print(f"[ML] Error loading specialist-{instrument}-{version}: {e}")
        return None


def save_specialist_model(model: keras.Model, instrument: str, version: str):
    os.makedirs(MODEL_DIR, exist_ok=True)
    path = os.path.join(MODEL_DIR, f"specialist-{instrument}-{version}.weights.h5")
    model.save_weights(path)
    input_shape = model.input_shape
    meta = {"feature_count": input_shape[2], "lookback": input_shape[1]}
    np.save(os.path.join(MODEL_DIR, f"specialist-{instrument}-{version}.meta.npy"), meta)

    latest_w = os.path.join(MODEL_DIR, f"specialist-{instrument}-latest.weights.h5")
    model.save_weights(latest_w)
    np.save(os.path.join(MODEL_DIR, f"specialist-{instrument}-latest.meta.npy"), meta)

    _save_to_mongo(path, meta, instrument, version)
    if version != "latest":
        _save_to_mongo(latest_w, meta, instrument, "latest")

    return path


def _save_to_mongo(weights_path: str, meta: dict, instrument: str, version: str):
    from app.data.mongo_client import get_collection
    from datetime import datetime

    with open(weights_path, "rb") as f:
        weights_bin = f.read()

    name = f"specialist-{instrument}-{version}"
    get_collection("ml_models").update_one(
        {"name": name},
        {"$set": {"name": name, "weights": weights_bin, "meta": meta, "updated_at": datetime.utcnow()}},
        upsert=True,
    )
    print(f"[ML] Saved {name} to MongoDB ({len(weights_bin)} bytes)")
