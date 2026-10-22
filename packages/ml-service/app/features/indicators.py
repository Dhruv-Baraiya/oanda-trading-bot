import numpy as np
import pandas as pd


def compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """Compute normalized technical indicator features from OHLCV.
    All outputs are scale-invariant (no raw price levels)."""
    result = pd.DataFrame(index=df.index)
    close = df["close"]

    # ATR(14) — compute first, used for normalization
    tr = pd.concat([
        df["high"] - df["low"],
        (df["high"] - close.shift(1)).abs(),
        (df["low"] - close.shift(1)).abs(),
    ], axis=1).max(axis=1)
    atr = tr.rolling(14).mean()
    atr_safe = atr.replace(0, np.nan)
    result["atr_pct"] = atr / close

    # RSI(14)
    delta = close.diff()
    gain = delta.where(delta > 0, 0).rolling(14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
    rs = gain / loss.replace(0, np.nan)
    result["rsi"] = 100 - (100 / (1 + rs))

    # MACD(12, 26, 9) — normalized by ATR
    ema12 = close.ewm(span=12).mean()
    ema26 = close.ewm(span=26).mean()
    macd = ema12 - ema26
    macd_signal = macd.ewm(span=9).mean()
    result["macd_norm"] = macd / atr_safe
    result["macd_signal_norm"] = macd_signal / atr_safe
    result["macd_hist_norm"] = (macd - macd_signal) / atr_safe

    # Bollinger Bands(20, 2) — relative position and width
    sma20 = close.rolling(20).mean()
    std20 = close.rolling(20).std()
    bb_upper = sma20 + 2 * std20
    bb_lower = sma20 - 2 * std20
    bb_range = (bb_upper - bb_lower).replace(0, np.nan)
    result["bb_percentB"] = (close - bb_lower) / bb_range
    result["bb_width"] = bb_range / close

    # EMA distances from close, normalized by ATR
    result["ema_short_dist"] = (close - close.ewm(span=20).mean()) / atr_safe
    result["ema_mid_dist"] = (close - close.ewm(span=50).mean()) / atr_safe
    result["ema_long_dist"] = (close - close.ewm(span=200).mean()) / atr_safe

    # EMA alignment: short vs mid vs long (trend strength)
    ema_short = close.ewm(span=20).mean()
    ema_mid = close.ewm(span=50).mean()
    ema_long = close.ewm(span=200).mean()
    result["ema_spread"] = (ema_short - ema_long) / atr_safe

    # RSI Divergence (simplified)
    price_highs = close.rolling(14).max() == close
    rsi_highs = result["rsi"].rolling(14).max() == result["rsi"]
    result["rsi_divergence"] = (price_highs & ~rsi_highs).astype(float)

    # ADX(14) — trend strength
    plus_dm = df["high"].diff()
    minus_dm = -df["low"].diff()
    plus_dm = plus_dm.where((plus_dm > minus_dm) & (plus_dm > 0), 0)
    minus_dm = minus_dm.where((minus_dm > plus_dm) & (minus_dm > 0), 0)
    plus_di = 100 * (plus_dm.ewm(span=14).mean() / atr_safe)
    minus_di = 100 * (minus_dm.ewm(span=14).mean() / atr_safe)
    dx = (100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan))
    result["adx"] = dx.ewm(span=14).mean()
    result["di_spread"] = (plus_di - minus_di) / 100

    # Stochastic %K/%D (14, 3)
    lowest_14 = df["low"].rolling(14).min()
    highest_14 = df["high"].rolling(14).max()
    stoch_range = (highest_14 - lowest_14).replace(0, np.nan)
    result["stoch_k"] = (close - lowest_14) / stoch_range
    result["stoch_d"] = result["stoch_k"].rolling(3).mean()

    # Volatility regime — ATR ratio and BB squeeze
    atr_50 = tr.rolling(50).mean().replace(0, np.nan)
    result["atr_ratio"] = atr / atr_50
    result["bb_squeeze"] = (bb_range / close) / result["atr_pct"].replace(0, np.nan)

    # Rate of change
    result["roc_5"] = close.pct_change(5)
    result["roc_10"] = close.pct_change(10)
    result["roc_20"] = close.pct_change(20)

    # EMA alignment score: +3 if perfectly bullish ordered, -3 if bearish
    ema_align = (
        (ema_short > ema_mid).astype(float) +
        (ema_mid > ema_long).astype(float) +
        (close > ema_short).astype(float)
    )
    result["ema_alignment"] = ema_align - 1.5

    # OBV trend (normalized by rolling std)
    obv = (np.sign(close.diff()) * df["volume"]).cumsum()
    obv_std = obv.rolling(50).std().replace(0, np.nan)
    result["obv_trend"] = (obv - obv.rolling(20).mean()) / obv_std

    return result
