import os
import numpy as np
from tensorflow import keras
from app.config import TRAINING_CONFIG, MODEL_DIR


def build_specialist_model(feature_count: int = 55, lookback: int = 60) -> keras.Model:
    cfg = TRAINING_CONFIG["specialist"]

    inputs = keras.Input(shape=(lookback, feature_count), name="candle_input")

    x = keras.layers.LSTM(cfg["lstm_layers"][0], return_sequences=True, dropout=cfg["dropout"])(inputs)
    x = keras.layers.LSTM(cfg["lstm_layers"][1], dropout=cfg["dropout"])(x)

    x = keras.layers.Dense(cfg["dense_units"], activation="relu")(x)

    confidence_out = keras.layers.Dense(1, activation="sigmoid", name="confidence")(x)
    size_out = keras.layers.Dense(1, activation="relu", name="optimal_size")(x)

    model = keras.Model(inputs=inputs, outputs=[confidence_out, size_out])
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=0.001),
        loss={"confidence": "binary_crossentropy", "optimal_size": "mse"},
        loss_weights=cfg["loss_weights"],
        metrics={"confidence": "accuracy"},
    )

    return model


def load_specialist_model(instrument: str, version: str = "latest") -> keras.Model | None:
    path = os.path.join(MODEL_DIR, f"specialist-{instrument}-{version}.h5")
    if not os.path.exists(path):
        return None
    return keras.models.load_model(path)


def save_specialist_model(model: keras.Model, instrument: str, version: str):
    os.makedirs(MODEL_DIR, exist_ok=True)
    path = os.path.join(MODEL_DIR, f"specialist-{instrument}-{version}.h5")
    model.save(path)
    return path
