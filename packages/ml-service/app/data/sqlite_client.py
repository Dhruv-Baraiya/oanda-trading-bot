import os
import sqlite3
import pandas as pd
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "data", "candles.db")


def _get_conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS candles (
            instrument TEXT NOT NULL,
            granularity TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            open REAL NOT NULL,
            high REAL NOT NULL,
            low REAL NOT NULL,
            close REAL NOT NULL,
            volume INTEGER NOT NULL,
            PRIMARY KEY (instrument, granularity, timestamp)
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_candles_lookup
        ON candles (instrument, granularity, timestamp)
    """)
    return conn


def fetch_candles_sqlite(
    instrument: str,
    granularity: str,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int | None = None,
) -> pd.DataFrame:
    conn = _get_conn()
    query = "SELECT timestamp, open, high, low, close, volume FROM candles WHERE instrument = ? AND granularity = ?"
    params: list = [instrument, granularity]

    if start:
        query += " AND timestamp >= ?"
        params.append(start.isoformat())
    if end:
        query += " AND timestamp <= ?"
        params.append(end.isoformat())

    query += " ORDER BY timestamp ASC"
    if limit:
        query += f" LIMIT {limit}"

    df = pd.read_sql_query(query, conn, params=params)
    conn.close()

    if df.empty:
        return df

    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df.set_index("timestamp")
    df = df[["open", "high", "low", "close", "volume"]].astype(float)
    return df


def upsert_candles(instrument: str, granularity: str, rows: list[dict]) -> int:
    conn = _get_conn()
    conn.executemany(
        """INSERT OR REPLACE INTO candles
           (instrument, granularity, timestamp, open, high, low, close, volume)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        [(instrument, granularity, r["timestamp"], r["open"], r["high"], r["low"], r["close"], r["volume"])
         for r in rows],
    )
    conn.commit()
    inserted = len(rows)
    conn.close()
    return inserted


def get_count(instrument: str | None = None, granularity: str | None = None) -> list[dict]:
    conn = _get_conn()
    query = "SELECT instrument, granularity, COUNT(*) as count FROM candles"
    params: list = []
    conditions = []
    if instrument:
        conditions.append("instrument = ?")
        params.append(instrument)
    if granularity:
        conditions.append("granularity = ?")
        params.append(granularity)
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " GROUP BY instrument, granularity"

    cursor = conn.execute(query, params)
    results = [{"instrument": r[0], "granularity": r[1], "count": r[2]} for r in cursor.fetchall()]
    conn.close()
    return results


def get_latest_timestamp(instrument: str, granularity: str) -> str | None:
    conn = _get_conn()
    cursor = conn.execute(
        "SELECT MAX(timestamp) FROM candles WHERE instrument = ? AND granularity = ?",
        [instrument, granularity],
    )
    row = cursor.fetchone()
    conn.close()
    return row[0] if row and row[0] else None
