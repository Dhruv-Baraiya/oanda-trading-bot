"""
Migrate candles from MongoDB Atlas to Cloudflare D1 via wrangler CLI.
Bypasses Worker row write limits by using `wrangler d1 execute --file`.

Usage:
  cd packages/d1-worker
  python ../../scripts/migrate-via-wrangler.py

Resumes from where it left off by checking max timestamp in D1 per group.
"""

import subprocess
import sys
import os
import tempfile
import time
from pymongo import MongoClient

MONGODB_URI = "mongodb+srv://dhruvbaraiya:Asd123@cluster0.4leg3v4.mongodb.net/trading"
DB_NAME = "trading"
D1_DB_NAME = "trading-bot-db"
BATCH_SIZE = 200  # rows per SQL file execution

GROUPS = [
    ("EUR_USD", "M1"),
    ("EUR_USD", "M15"),
    ("EUR_USD", "H1"),
    ("EUR_USD", "H4"),
]


def run_wrangler(sql_command=None, sql_file=None):
    cmd = ["npx", "wrangler", "d1", "execute", D1_DB_NAME, "--remote"]
    if sql_command:
        cmd += ["--command", sql_command]
    elif sql_file:
        cmd += ["--file", sql_file]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(f"Wrangler error: {result.stderr}")
    return result.stdout


def get_d1_max_timestamp(instrument, granularity):
    sql = f"SELECT MAX(timestamp) as max_ts FROM candles WHERE instrument='{instrument}' AND granularity='{granularity}';"
    output = run_wrangler(sql_command=sql)
    if '"max_ts":' in output:
        import json
        start = output.index("[")
        end = output.rindex("]") + 1
        data = json.loads(output[start:end])
        max_ts = data[0]["results"][0]["max_ts"]
        return max_ts
    return None


def get_d1_count(instrument, granularity):
    sql = f"SELECT COUNT(*) as cnt FROM candles WHERE instrument='{instrument}' AND granularity='{granularity}';"
    output = run_wrangler(sql_command=sql)
    import json
    start = output.index("[")
    end = output.rindex("]") + 1
    data = json.loads(output[start:end])
    return data[0]["results"][0]["cnt"]


def escape_sql(val):
    if isinstance(val, str):
        return val.replace("'", "''")
    return str(val)


def migrate_group(mongo_col, instrument, granularity):
    max_ts = get_d1_max_timestamp(instrument, granularity)
    d1_count = get_d1_count(instrument, granularity)

    query = {"instrument": instrument, "granularity": granularity}
    if max_ts:
        from datetime import datetime
        if isinstance(max_ts, str):
            for fmt in ["%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S"]:
                try:
                    max_dt = datetime.strptime(max_ts, fmt)
                    break
                except ValueError:
                    continue
            else:
                max_dt = datetime.fromisoformat(max_ts.replace("Z", "+00:00"))
        query["timestamp"] = {"$gt": max_dt}

    mongo_count = mongo_col.count_documents(query)
    total_in_mongo = mongo_col.count_documents({"instrument": instrument, "granularity": granularity})

    print(f"\n{'='*60}")
    print(f"  {instrument}/{granularity}")
    print(f"  MongoDB total: {total_in_mongo:,}")
    print(f"  D1 has: {d1_count:,}")
    print(f"  Remaining: {mongo_count:,}")
    if max_ts:
        print(f"  Resuming after: {max_ts}")
    print(f"{'='*60}")

    if mongo_count == 0:
        print("  Already fully migrated!")
        return 0

    cursor = mongo_col.find(query).sort("timestamp", 1)

    migrated = 0
    batch = []
    batch_num = 0
    errors = 0

    for doc in cursor:
        ts = doc["timestamp"]
        if hasattr(ts, "isoformat"):
            ts_str = ts.strftime("%Y-%m-%dT%H:%M:%S")
        else:
            ts_str = str(ts)

        batch.append((
            escape_sql(instrument),
            escape_sql(granularity),
            escape_sql(ts_str),
            doc["open"],
            doc["high"],
            doc["low"],
            doc["close"],
            doc["volume"],
        ))

        if len(batch) >= BATCH_SIZE:
            ok = execute_batch(batch)
            if ok:
                migrated += len(batch)
                batch_num += 1
                if batch_num % 25 == 0:
                    print(f"    batch {batch_num} — {migrated:,}/{mongo_count:,} ({100*migrated/mongo_count:.1f}%)")
            else:
                errors += 1
                if errors > 5:
                    print("  Too many errors, stopping group")
                    break
            batch = []

    if batch:
        ok = execute_batch(batch)
        if ok:
            migrated += len(batch)

    print(f"  Done: {migrated:,} migrated")
    return migrated


def execute_batch(batch):
    values = []
    for row in batch:
        vals = f"('{row[0]}','{row[1]}','{row[2]}',{row[3]},{row[4]},{row[5]},{row[6]},{row[7]})"
        values.append(vals)

    sql = (
        "INSERT INTO candles (instrument, granularity, timestamp, open, high, low, close, volume) VALUES\n"
        + ",\n".join(values)
        + "\nON CONFLICT(instrument, granularity, timestamp) DO UPDATE SET "
        "open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close, volume=excluded.volume;"
    )

    tmp_path = os.path.join(tempfile.gettempdir(), "d1_batch.sql")
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(sql)

    try:
        run_wrangler(sql_file=tmp_path)
        return True
    except Exception as e:
        print(f"    ERROR: {e}")
        time.sleep(2)
        try:
            run_wrangler(sql_file=tmp_path)
            return True
        except Exception as e2:
            print(f"    RETRY FAILED: {e2}")
            return False


def main():
    print("Connecting to MongoDB Atlas...")
    client = MongoClient(MONGODB_URI)
    db = client[DB_NAME]
    col = db["candles"]

    print(f"MongoDB connected. Database: {DB_NAME}")
    print(f"D1 database: {D1_DB_NAME}")
    print(f"Batch size: {BATCH_SIZE} rows per wrangler call")

    total_migrated = 0
    start = time.time()

    for instrument, granularity in GROUPS:
        count = migrate_group(col, instrument, granularity)
        total_migrated += count

    elapsed = time.time() - start
    print(f"\n{'='*60}")
    print(f"Migration complete!")
    print(f"Total migrated: {total_migrated:,}")
    print(f"Time: {elapsed/60:.1f} minutes")
    print(f"{'='*60}")

    client.close()


if __name__ == "__main__":
    main()
