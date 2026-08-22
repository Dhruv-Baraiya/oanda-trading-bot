import os
import io
import tempfile
import numpy as np
import lightgbm as lgb
import joblib
from app.config import MODEL_DIR, MODEL_STORAGE


def build_lgbm_model(params: dict | None = None) -> lgb.LGBMClassifier:
    default_params = {
        "objective": "binary",
        "metric": "binary_logloss",
        "boosting_type": "gbdt",
        "num_leaves": 31,
        "max_depth": 6,
        "learning_rate": 0.05,
        "n_estimators": 500,
        "min_child_samples": 50,
        "subsample": 0.8,
        "colsample_bytree": 0.8,
        "reg_alpha": 0.1,
        "reg_lambda": 0.1,
        "random_state": 42,
        "verbose": -1,
        "is_unbalance": True,
    }
    if params:
        default_params.update(params)
    return lgb.LGBMClassifier(**default_params)


def train_lgbm(
    X_train: np.ndarray,
    y_train: np.ndarray,
    X_val: np.ndarray,
    y_val: np.ndarray,
    params: dict | None = None,
) -> tuple[lgb.LGBMClassifier, dict]:
    model = build_lgbm_model(params)

    model.fit(
        X_train, y_train,
        eval_set=[(X_val, y_val)],
        callbacks=[
            lgb.early_stopping(50, verbose=True),
            lgb.log_evaluation(50),
        ],
    )

    val_preds = model.predict_proba(X_val)[:, 1]
    val_acc = np.mean((val_preds > 0.5).astype(int) == y_val)
    train_preds = model.predict_proba(X_train)[:, 1]
    train_acc = np.mean((train_preds > 0.5).astype(int) == y_train)

    importance = dict(zip(
        [f"f{i}" for i in range(X_train.shape[1])],
        model.feature_importances_.tolist(),
    ))

    metrics = {
        "train_accuracy": float(train_acc),
        "val_accuracy": float(val_acc),
        "best_iteration": model.best_iteration_,
        "n_features": X_train.shape[1],
        "top_features": sorted(importance.items(), key=lambda x: -x[1])[:10],
    }
    return model, metrics


def save_lgbm_model(model: lgb.LGBMClassifier, name: str, version: str, meta: dict):
    os.makedirs(MODEL_DIR, exist_ok=True)
    path = os.path.join(MODEL_DIR, f"{name}-{version}.lgbm.pkl")
    joblib.dump(model, path)

    for v in [version, "latest"]:
        vpath = os.path.join(MODEL_DIR, f"{name}-{v}.lgbm.pkl")
        joblib.dump(model, vpath)

        if MODEL_STORAGE == "mongo":
            _save_to_mongo(model, meta, name, v)

    return path


def load_lgbm_model(name: str, version: str = "latest") -> lgb.LGBMClassifier | None:
    path = os.path.join(MODEL_DIR, f"{name}-{version}.lgbm.pkl")
    if os.path.exists(path):
        return joblib.load(path)

    if MODEL_STORAGE == "mongo":
        return _load_from_mongo(name, version)
    return None


def _save_to_mongo(model: lgb.LGBMClassifier, meta: dict, name: str, version: str):
    from app.data.mongo_client import get_collection
    from datetime import datetime

    buf = io.BytesIO()
    joblib.dump(model, buf)
    weights_bin = buf.getvalue()

    get_collection("ml_models").update_one(
        {"name": f"{name}-{version}"},
        {"$set": {
            "name": f"{name}-{version}",
            "weights": weights_bin,
            "meta": meta,
            "model_type": "lgbm",
            "updated_at": datetime.utcnow(),
        }},
        upsert=True,
    )
    print(f"[ML] Saved {name}-{version} to MongoDB ({len(weights_bin)} bytes)")


def _load_from_mongo(name: str, version: str) -> lgb.LGBMClassifier | None:
    from app.data.mongo_client import get_collection

    doc = get_collection("ml_models").find_one({"name": f"{name}-{version}"})
    if not doc or doc.get("model_type") != "lgbm":
        return None

    buf = io.BytesIO(doc["weights"])
    model = joblib.load(buf)
    print(f"[ML] Loaded {name}-{version} from MongoDB (lgbm)")
    return model
