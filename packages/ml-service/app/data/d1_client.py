import os
import time
import requests
import pandas as pd
from datetime import datetime

D1_WORKER_URL = os.getenv("D1_WORKER_URL", "http://localhost:8787")
D1_API_KEY = os.getenv("D1_API_KEY", "CHANGE_ME_TO_A_SECURE_KEY")

HEADERS = {
    "Content-Type": "application/json",
    "X-API-Key": D1_API_KEY,
    "Connection": "close",
}


def _d1_get(url: str, params: dict, timeout: int = 60):
    for attempt in range(4):
        try:
            resp = requests.get(url, params=params, headers=HEADERS, timeout=timeout)
            resp.raise_for_status()
            return resp
        except requests.exceptions.RequestException as e:
            if attempt == 3:
                raise
            wait = 2 ** attempt
            print(f"[D1] Retry {attempt+1}/3 after {wait}s: {e}")
            time.sleep(wait)


def fetch_candles_d1(
    instrument: str,
    granularity: str,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int | None = None,
) -> pd.DataFrame:
    PAGE_SIZE = 5000
    cursor_from = start.isoformat() if start else None
    to_str = end.isoformat() if end else None

    all_records: list = []

    while True:
        params: dict = {
            "instrument": instrument,
            "granularity": granularity,
            "limit": str(limit or PAGE_SIZE),
            "offset": "0",
        }
        if cursor_from:
            params["from"] = cursor_from
        if to_str:
            params["to"] = to_str

        resp = _d1_get(f"{D1_WORKER_URL}/candles", params)
        records = resp.json().get("candles", [])
        if not records:
            break

        if all_records and records[0]["timestamp"] == all_records[-1]["timestamp"]:
            records = records[1:]
        if not records:
            break

        all_records.extend(records)
        if limit or len(records) < (limit or PAGE_SIZE):
            break

        cursor_from = records[-1]["timestamp"]
        print(f"[D1] Fetched {len(all_records)} {granularity} candles so far...")
        time.sleep(0.2)

    if not all_records:
        return pd.DataFrame()

    df = pd.DataFrame(all_records)
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, format="ISO8601").dt.tz_localize(None)
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
