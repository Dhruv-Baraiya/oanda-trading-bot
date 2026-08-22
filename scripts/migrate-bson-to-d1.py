"""
Migrate candles from mongodump BSON to Cloudflare D1 via REST API.
Auto-refreshes OAuth token via wrangler.

Prerequisites: pip install pymongo requests, wrangler login

Usage:
  BSON_FILE=path/to/candles.bson python scripts/migrate-bson-to-d1.py

  Windows:
  set BSON_FILE=C:\path\to\candles.bson
  python scripts\migrate-bson-to-d1.py
"""

import bson
import requests
import os
import sys
import time
import json

BSON_FILE = os.environ.get("BSON_FILE", "candles.bson")
ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID", "b0fa0ddaecd5005fa15f4b76f8606aa2")
DATABASE_ID = os.environ.get("CF_DATABASE_ID", "2f7bfb08-ef7d-41d3-b98f-f1e7a7248f17")
BATCH_SIZE = int(os.environ.get("BATCH_SIZE", "500"))
TOTAL_ESTIMATE = 2_404_770

if sys.platform == "win32":
    WRANGLER_CONFIG = os.path.join(os.environ.get("APPDATA", ""), "xdg.config", ".wrangler", "config", "default.toml")
else:
    WRANGLER_CONFIG = os.path.expanduser("~/.wrangler/config/default.toml")

D1_API_URL = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/d1/database/{DATABASE_ID}/query"

last_token = None
last_token_time = 0


def read_token_from_wrangler():
    with open(WRANGLER_CONFIG, "r") as f:
        for line in f:
            if line.startswith("oauth_token"):
                return line.split('"')[1]
    raise RuntimeError("No oauth_token found in wrangler config")


def refresh_via_wrangler():
    """Call wrangler whoami to force token refresh, then read from config."""
    import subprocess
    subprocess.run(["npx.cmd", "wrangler", "whoami"], capture_output=True, timeout=30,
                   cwd=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "packages", "d1-worker"))
    return read_token_from_wrangler()


def get_token():
    global last_token, last_token_time
    now = time.time()
    if not last_token or (now - last_token_time) > 2400:  # refresh every 40 min
        try:
            last_token = refresh_via_wrangler()
            last_token_time = now
            print(f"  Token refreshed via wrangler", flush=True)
        except Exception as e:
            print(f"  Token refresh warning: {e}", flush=True)
            if not last_token:
                last_token = read_token_from_wrangler()
                last_token_time = now
    return last_token


def execute_d1_sql(sql):
    headers = {
        "Authorization": f"Bearer {get_token()}",
        "Content-Type": "application/json",
    }
    resp = requests.post(D1_API_URL, json={"sql": sql}, headers=headers, timeout=120)
    if resp.status_code != 200:
        raise RuntimeError(f"D1 API {resp.status_code}: {resp.text[:300]}")
    data = resp.json()
    if not data.get("success"):
        raise RuntimeError(f"D1 API error: {json.dumps(data.get('errors', []))[:300]}")
    return data


def escape_sql(val):
    if isinstance(val, str):
        return val.replace("'", "''")
    return str(val)


def format_timestamp(ts):
    if hasattr(ts, "strftime"):
        return ts.strftime("%Y-%m-%dT%H:%M:%S")
    return str(ts)


def execute_batch(batch):
    values = []
    for row in batch:
        vals = f"('{row[0]}','{row[1]}','{row[2]}',{row[3]},{row[4]},{row[5]},{row[6]},{row[7]})"
        values.append(vals)

    sql = (
        "INSERT INTO candles (instrument,granularity,timestamp,open,high,low,close,volume) VALUES "
        + ",".join(values)
        + " ON CONFLICT(instrument,granularity,timestamp) DO UPDATE SET "
        "open=excluded.open,high=excluded.high,low=excluded.low,close=excluded.close,volume=excluded.volume;"
    )
    execute_d1_sql(sql)


def read_bson_docs(filepath):
    with open(filepath, "rb") as f:
        while True:
            size_bytes = f.read(4)
            if not size_bytes or len(size_bytes) < 4:
                break
            doc_size = int.from_bytes(size_bytes, "little")
            doc_data = size_bytes + f.read(doc_size - 4)
            doc = bson.BSON(doc_data).decode()
            yield doc


def main():
    if not os.path.exists(BSON_FILE):
        print(f"BSON file not found: {BSON_FILE}")
        sys.exit(1)

    file_size = os.path.getsize(BSON_FILE)
    print(f"BSON file: {file_size / 1024 / 1024:.0f} MB", flush=True)
    print(f"Batch size: {BATCH_SIZE}", flush=True)
    print(f"Using D1 REST API (no wrangler)", flush=True)
    print(flush=True)

    total = 0
    batch = []
    batch_num = 0
    consecutive_errors = 0
    start = time.time()

    for doc in read_bson_docs(BSON_FILE):
        instrument = doc.get("instrument", "")
        granularity = doc.get("granularity", "")
        ts = format_timestamp(doc.get("timestamp", ""))

        batch.append((
            escape_sql(instrument),
            escape_sql(granularity),
            escape_sql(ts),
            doc.get("open", 0),
            doc.get("high", 0),
            doc.get("low", 0),
            doc.get("close", 0),
            doc.get("volume", 0),
        ))

        if len(batch) >= BATCH_SIZE:
            try:
                execute_batch(batch)
                total += len(batch)
                batch_num += 1
                consecutive_errors = 0
                if batch_num % 50 == 0:
                    elapsed = time.time() - start
                    rate = total / elapsed if elapsed > 0 else 0
                    remaining = TOTAL_ESTIMATE - total
                    eta = remaining / rate / 60 if rate > 0 else 0
                    print(f"  {total:,}/{TOTAL_ESTIMATE:,} ({100*total/TOTAL_ESTIMATE:.1f}%) — {rate:.0f} rows/s — ETA {eta:.0f} min", flush=True)
            except Exception as e:
                consecutive_errors += 1
                err_str = str(e)
                print(f"  ERROR batch {batch_num}: {err_str[:200]}", flush=True)
                if consecutive_errors > 10:
                    print(f"Too many consecutive errors. Stopped at {total:,}.", flush=True)
                    break
                time.sleep(3)
                try:
                    execute_batch(batch)
                    total += len(batch)
                    batch_num += 1
                    consecutive_errors = 0
                except Exception as e2:
                    print(f"  Retry failed: {str(e2)[:200]}", flush=True)
            batch = []

    if batch:
        try:
            execute_batch(batch)
            total += len(batch)
        except Exception as e:
            print(f"  Final batch error: {e}", flush=True)

    elapsed = time.time() - start
    print(f"\n{'='*60}", flush=True)
    print(f"Migration complete!", flush=True)
    print(f"Total migrated: {total:,}", flush=True)
    print(f"Time: {elapsed/60:.1f} minutes", flush=True)
    print(f"{'='*60}", flush=True)


if __name__ == "__main__":
    main()
