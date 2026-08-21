import pandas as pd
from datetime import datetime
from app.data.d1_client import fetch_candles_d1
from app.data.mongo_client import get_collection


def fetch_candles(
    instrument: str,
    granularity: str,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int | None = None,
) -> pd.DataFrame:
    return fetch_candles_d1(instrument, granularity, start, end, limit)


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
