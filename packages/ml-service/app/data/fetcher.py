import pandas as pd
from datetime import datetime
from app.data.mongo_client import get_collection


def fetch_candles(
    instrument: str,
    granularity: str,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int | None = None,
) -> pd.DataFrame:
    col = get_collection("candles")
    query: dict = {"instrument": instrument, "granularity": granularity}
    if start or end:
        query["timestamp"] = {}
        if start:
            query["timestamp"]["$gte"] = start
        if end:
            query["timestamp"]["$lte"] = end

    cursor = col.find(query).sort("timestamp", 1)
    if limit:
        cursor = cursor.limit(limit)

    records = list(cursor)
    if not records:
        return pd.DataFrame()

    df = pd.DataFrame(records)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df.set_index("timestamp")
    df = df[["open", "high", "low", "close", "volume"]].astype(float)
    return df


def fetch_sentiment(
    instrument: str,
    source: str = "positionBook",
    start: datetime | None = None,
    end: datetime | None = None,
) -> pd.DataFrame:
    col = get_collection("sentiments")
    query: dict = {"instrument": instrument, "source": source}
    if start or end:
        query["timestamp"] = {}
        if start:
            query["timestamp"]["$gte"] = start
        if end:
            query["timestamp"]["$lte"] = end

    records = list(col.find(query).sort("timestamp", 1))
    if not records:
        return pd.DataFrame()

    df = pd.DataFrame(records)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df.set_index("timestamp")
    return df[["longRatio", "shortRatio"]]
