"""
Migrate candle data from MongoDB Atlas to Cloudflare D1 via Worker API.
Also migrates ML model weights to R2.

Usage:
  python scripts/migrate-to-d1.py --mongodb-uri "mongodb+srv://..." --d1-url "https://your-worker.workers.dev" --api-key "your-key"

Flags:
  --candles     Migrate candle data (default: on)
  --models      Migrate ML model weights (default: on)
  --skip-candles  Skip candle migration
  --skip-models   Skip model migration
  --batch-size  Candles per HTTP request (default: 500)
"""

import argparse
import json
import sys
import time
import requests
from pymongo import MongoClient


def migrate_candles(mongo_db, d1_url: str, api_key: str, batch_size: int = 500):
    col = mongo_db["candles"]
    headers = {"Content-Type": "application/json", "X-API-Key": api_key}

    pipeline = [
        {"$group": {"_id": {"instrument": "$instrument", "granularity": "$granularity"}, "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
    ]

    groups = list(col.aggregate(pipeline))
    total_docs = sum(g["count"] for g in groups)
    print(f"Found {len(groups)} instrument/granularity groups, {total_docs:,} total candles")

    migrated = 0
    for group in groups:
        instrument = group["_id"]["instrument"]
        granularity = group["_id"]["granularity"]
        count = group["count"]
        print(f"\n  {instrument}/{granularity}: {count:,} candles")

        cursor = col.find(
            {"instrument": instrument, "granularity": granularity}
        ).sort("timestamp", 1)

        batch = []
        batch_num = 0
        for doc in cursor:
            batch.append({
                "instrument": instrument,
                "granularity": granularity,
                "timestamp": doc["timestamp"].isoformat(),
                "open": doc["open"],
                "high": doc["high"],
                "low": doc["low"],
                "close": doc["close"],
                "volume": doc["volume"],
            })

            if len(batch) >= batch_size:
                resp = requests.post(
                    f"{d1_url}/candles",
                    json={"candles": batch},
                    headers=headers,
                    timeout=60,
                )
                resp.raise_for_status()
                result = resp.json()
                migrated += result.get("inserted", len(batch))
                batch_num += 1
                if batch_num % 10 == 0:
                    print(f"    batch {batch_num} — {migrated:,} total migrated")
                batch = []
                time.sleep(0.1)

        if batch:
            resp = requests.post(
                f"{d1_url}/candles",
                json={"candles": batch},
                headers=headers,
                timeout=60,
            )
            resp.raise_for_status()
            result = resp.json()
            migrated += result.get("inserted", len(batch))

        print(f"    done — {migrated:,} total migrated so far")

    print(f"\nCandle migration complete: {migrated:,} candles migrated")
    return migrated


def migrate_models(mongo_db, d1_url: str, api_key: str):
    col = mongo_db["ml_models"]
    headers_json = {"Content-Type": "application/json", "X-API-Key": api_key}
    headers_bin = {"Content-Type": "application/octet-stream", "X-API-Key": api_key}

    models = list(col.find())
    print(f"Found {len(models)} ML models to migrate")

    for doc in models:
        name = doc["name"]
        meta = doc.get("meta", {})
        weights = doc.get("weights", b"")

        print(f"  Uploading {name} ({len(weights):,} bytes)...")

        resp = requests.put(
            f"{d1_url}/models/{name}",
            data=weights,
            headers=headers_bin,
            timeout=60,
        )
        resp.raise_for_status()

        resp = requests.put(
            f"{d1_url}/models/{name}/meta",
            json=meta,
            headers=headers_json,
            timeout=10,
        )
        resp.raise_for_status()

        print(f"    done")

    print(f"\nModel migration complete: {len(models)} models migrated to R2")


def main():
    parser = argparse.ArgumentParser(description="Migrate data from MongoDB Atlas to Cloudflare D1/R2")
    parser.add_argument("--mongodb-uri", required=True, help="MongoDB connection URI")
    parser.add_argument("--d1-url", required=True, help="D1 Worker URL")
    parser.add_argument("--api-key", required=True, help="D1 Worker API key")
    parser.add_argument("--batch-size", type=int, default=500, help="Candles per batch")
    parser.add_argument("--skip-candles", action="store_true", help="Skip candle migration")
    parser.add_argument("--skip-models", action="store_true", help="Skip model migration")
    args = parser.parse_args()

    client = MongoClient(args.mongodb_uri)
    db_name = args.mongodb_uri.rsplit("/", 1)[-1].split("?")[0] or "trading"
    db = client[db_name]

    print(f"Connected to MongoDB: {db_name}")
    print(f"D1 Worker: {args.d1_url}")
    print()

    if not args.skip_candles:
        migrate_candles(db, args.d1_url, args.api_key, args.batch_size)
        print()

    if not args.skip_models:
        migrate_models(db, args.d1_url, args.api_key)

    print("\nMigration complete!")
    client.close()


if __name__ == "__main__":
    main()
