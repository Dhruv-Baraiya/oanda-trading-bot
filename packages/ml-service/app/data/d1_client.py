import os
import requests
import pandas as pd
from datetime import datetime

D1_WORKER_URL = os.getenv("D1_WORKER_URL", "http://localhost:8787")
D1_API_KEY = os.getenv("D1_API_KEY", "CHANGE_ME_TO_A_SECURE_KEY")

HEADERS = {
    "Content-Type": "application/json",
    "X-API-Key": D1_API_KEY,
}


def fetch_candles_d1(
    instrument: str,
    granularity: str,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int | None = None,
) -> pd.DataFrame:
    params = {"instrument": instrument, "granularity": granularity}
    if start:
        params["from"] = start.isoformat()
    if end:
        params["to"] = end.isoformat()
    if limit:
        params["limit"] = str(limit)

    resp = requests.get(f"{D1_WORKER_URL}/candles", params=params, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    records = data.get("candles", [])
    if not records:
        return pd.DataFrame()

    df = pd.DataFrame(records)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df.set_index("timestamp")
    df = df[["open", "high", "low", "close", "volume"]].astype(float)
    return df


def get_model_weights(name: str) -> bytes | None:
    resp = requests.get(f"{D1_WORKER_URL}/models/{name}", headers=HEADERS, timeout=30)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.content


def get_model_meta(name: str) -> dict | None:
    resp = requests.get(f"{D1_WORKER_URL}/models/{name}/meta", headers=HEADERS, timeout=10)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    return resp.json()


def save_model_weights(name: str, weights_path: str, meta: dict) -> None:
    with open(weights_path, "rb") as f:
        resp = requests.put(
            f"{D1_WORKER_URL}/models/{name}",
            data=f.read(),
            headers={"X-API-Key": D1_API_KEY, "Content-Type": "application/octet-stream"},
            timeout=60,
        )
        resp.raise_for_status()

    resp = requests.put(
        f"{D1_WORKER_URL}/models/{name}/meta",
        json=meta,
        headers=HEADERS,
        timeout=10,
    )
    resp.raise_for_status()
