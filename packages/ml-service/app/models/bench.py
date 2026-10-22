"""Bench system: rejected signals sit out for a cooldown period.
Prevents whipsaw entries on the same instrument/regime."""

import os
import sqlite3
import time

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "data", "bench.db")

BENCH_MINUTES = {
    "choppy_regime": 90,
    "low_confidence": 30,
    "mtf_disagreement": 45,
    "question_disagreement": 30,
    "momentum_exhausted": 60,
    "volatility_low": 45,
    "default": 30,
}


def _get_conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS bench (
            instrument TEXT,
            granularity TEXT,
            reason TEXT,
            expires_at REAL,
            created_at REAL,
            PRIMARY KEY (instrument, granularity)
        )
    """)
    conn.commit()
    return conn


def is_benched(instrument: str, granularity: str) -> dict | None:
    conn = _get_conn()
    row = conn.execute(
        "SELECT reason, expires_at FROM bench WHERE instrument=? AND granularity=? AND expires_at > ?",
        (instrument, granularity, time.time()),
    ).fetchone()
    conn.close()
    if row:
        return {"reason": row[0], "minutes_left": round((row[1] - time.time()) / 60, 1)}
    return None


def sit(instrument: str, granularity: str, reason: str):
    minutes = BENCH_MINUTES.get(reason, BENCH_MINUTES["default"])
    expires = time.time() + minutes * 60
    conn = _get_conn()
    conn.execute(
        "INSERT OR REPLACE INTO bench (instrument, granularity, reason, expires_at, created_at) VALUES (?,?,?,?,?)",
        (instrument, granularity, reason, expires, time.time()),
    )
    conn.commit()
    conn.close()


def release(instrument: str, granularity: str):
    conn = _get_conn()
    conn.execute("DELETE FROM bench WHERE instrument=? AND granularity=?", (instrument, granularity))
    conn.commit()
    conn.close()


def clear_expired():
    conn = _get_conn()
    conn.execute("DELETE FROM bench WHERE expires_at <= ?", (time.time(),))
    conn.commit()
    conn.close()
