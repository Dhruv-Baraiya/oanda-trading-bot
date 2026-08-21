CREATE TABLE IF NOT EXISTS candles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instrument TEXT NOT NULL,
  granularity TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_candles_unique
  ON candles (instrument, granularity, timestamp);

CREATE INDEX IF NOT EXISTS idx_candles_instrument_gran
  ON candles (instrument, granularity, timestamp);
