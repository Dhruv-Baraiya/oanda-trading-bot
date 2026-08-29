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

    return result
