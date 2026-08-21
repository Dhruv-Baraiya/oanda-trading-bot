import os
import tempfile
import numpy as np
import tensorflow as tf
from tensorflow import keras
from app.config import TRAINING_CONFIG, MODEL_DIR, MODEL_STORAGE


class WeightedSum(keras.layers.Layer):
    def call(self, inputs):
        return tf.reduce_sum(inputs, axis=1)

    def compute_output_shape(self, input_shape):
        return (input_shape[0], input_shape[2])


def build_universal_model(feature_count: int = 49, lookback: int = 60) -> keras.Model:
    cfg = TRAINING_CONFIG["universal"]

    inputs = keras.Input(shape=(lookback, feature_count), name="candle_input")

    x = keras.layers.LSTM(cfg["lstm_layers"][0], return_sequences=True, dropout=cfg["dropout"])(inputs)
    x = keras.layers.LSTM(cfg["lstm_layers"][1], return_sequences=True, dropout=cfg["dropout"])(x)

    # Attention
    if cfg["attention"]:
        attention = keras.layers.Dense(1, activation="tanh")(x)
        attention = keras.layers.Flatten()(attention)
        attention = keras.layers.Activation("softmax")(attention)
        attention = keras.layers.RepeatVector(cfg["lstm_layers"][1])(attention)
        attention = keras.layers.Permute([2, 1])(attention)
        x = keras.layers.Multiply()([x, attention])
        x = WeightedSum()(x)
    else:
        x = x[:, -1, :]

    x = keras.layers.Dense(cfg["dense_units"], activation="relu")(x)
    x = keras.layers.Dropout(cfg["dropout"])(x)

    direction_out = keras.layers.Dense(3, activation="softmax", name="direction")(x)
    magnitude_out = keras.layers.Dense(1, activation="linear", name="magnitude")(x)

    model = keras.Model(inputs=inputs, outputs=[direction_out, magnitude_out])
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=cfg["initial_lr"]),
        loss={"direction": "categorical_crossentropy", "magnitude": "mse"},
        loss_weights=cfg["loss_weights"],
        metrics={"direction": "accuracy"},
    )

    return model


def load_universal_model(version: str = "latest") -> keras.Model | None:
    path = os.path.join(MODEL_DIR, f"universal-{version}.weights.h5")
    meta_path = os.path.join(MODEL_DIR, f"universal-{version}.meta.npy")

    if os.path.exists(path) and os.path.exists(meta_path):
        meta = np.load(meta_path, allow_pickle=True).item()
        model = build_universal_model(feature_count=meta["feature_count"], lookback=meta["lookback"])
        try:
            model.load_weights(path)
            return model
        except (ValueError, Exception) as e:
            print(f"[ML] Weight mismatch for local {version}: {e}")

    if MODEL_STORAGE == "r2":
        return _load_from_r2(version)
    return _load_from_mongo(version)


def _load_from_mongo(version: str) -> keras.Model | None:
    from app.data.mongo_client import get_collection

    doc = get_collection("ml_models").find_one({"name": f"universal-{version}"})
    if not doc:
        return None

    meta = doc["meta"]
    model = build_universal_model(feature_count=meta["feature_count"], lookback=meta["lookback"])

    tmp = tempfile.NamedTemporaryFile(suffix=".weights.h5", delete=False)
    tmp.write(doc["weights"])
    tmp.close()
    try:
        model.load_weights(tmp.name)
    except (ValueError, Exception) as e:
        os.unlink(tmp.name)
        print(f"[ML] Weight mismatch for MongoDB {version}: {e}")
        return None
    os.unlink(tmp.name)

    print(f"[ML] Loaded universal-{version} from MongoDB")
    return model


def _load_from_r2(version: str) -> keras.Model | None:
    from app.data.d1_client import get_model_weights, get_model_meta

    meta = get_model_meta(f"universal-{version}")
    if not meta:
        return None

    weights_data = get_model_weights(f"universal-{version}")
    if not weights_data:
        return None

    model = build_universal_model(feature_count=meta["feature_count"], lookback=meta["lookback"])

    tmp = tempfile.NamedTemporaryFile(suffix=".weights.h5", delete=False)
    tmp.write(weights_data)
    tmp.close()
    try:
        model.load_weights(tmp.name)
    except (ValueError, Exception) as e:
        os.unlink(tmp.name)
        print(f"[ML] Weight mismatch for R2 {version}: {e}")
        return None
    os.unlink(tmp.name)

    print(f"[ML] Loaded universal-{version} from R2")
    return model


def save_universal_model(model: keras.Model, version: str):
    os.makedirs(MODEL_DIR, exist_ok=True)
    path = os.path.join(MODEL_DIR, f"universal-{version}.weights.h5")
    model.save_weights(path)
    input_shape = model.input_shape
    meta = {"feature_count": input_shape[2], "lookback": input_shape[1]}
    np.save(os.path.join(MODEL_DIR, f"universal-{version}.meta.npy"), meta)

    latest_w = os.path.join(MODEL_DIR, "universal-latest.weights.h5")
    model.save_weights(latest_w)
    np.save(os.path.join(MODEL_DIR, "universal-latest.meta.npy"), meta)

    if MODEL_STORAGE == "r2":
        _save_to_r2(path, meta, version)
        if version != "latest":
            _save_to_r2(latest_w, meta, "latest")
    else:
        _save_to_mongo(path, meta, version)
        if version != "latest":
            _save_to_mongo(latest_w, meta, "latest")

    return path


def _save_to_mongo(weights_path: str, meta: dict, version: str):
    from app.data.mongo_client import get_collection
    from datetime import datetime

    with open(weights_path, "rb") as f:
        weights_bin = f.read()

    get_collection("ml_models").update_one(
        {"name": f"universal-{version}"},
        {"$set": {
            "name": f"universal-{version}",
            "weights": weights_bin,
            "meta": meta,
            "updated_at": datetime.utcnow(),
        }},
        upsert=True,
    )
    print(f"[ML] Saved universal-{version} to MongoDB ({len(weights_bin)} bytes)")


def _save_to_r2(weights_path: str, meta: dict, version: str):
    from app.data.d1_client import save_model_weights

    save_model_weights(f"universal-{version}", weights_path, meta)
    print(f"[ML] Saved universal-{version} to R2")
