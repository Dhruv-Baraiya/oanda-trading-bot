import numpy as np
import pandas as pd


def compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """Compute 15 technical indicator features from OHLCV."""
    result = pd.DataFrame(index=df.index)
    close = df["close"]

    # RSI(14)
    delta = close.diff()
    gain = delta.where(delta > 0, 0).rolling(14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(14).mean()
    rs = gain / loss.replace(0, np.nan)
    result["rsi"] = 100 - (100 / (1 + rs))

    # MACD(12, 26, 9)
    ema12 = close.ewm(span=12).mean()
    ema26 = close.ewm(span=26).mean()
    result["macd"] = ema12 - ema26
    result["macd_signal"] = result["macd"].ewm(span=9).mean()
    result["macd_hist"] = result["macd"] - result["macd_signal"]

    # Bollinger Bands(20, 2)
    sma20 = close.rolling(20).mean()
    std20 = close.rolling(20).std()
    result["bb_upper"] = sma20 + 2 * std20
    result["bb_middle"] = sma20
    result["bb_lower"] = sma20 - 2 * std20
    bb_range = result["bb_upper"] - result["bb_lower"]
    result["bb_percentB"] = (close - result["bb_lower"]) / bb_range.replace(0, np.nan)

    # ATR(14)
    tr = pd.concat([
        df["high"] - df["low"],
        (df["high"] - close.shift(1)).abs(),
        (df["low"] - close.shift(1)).abs(),
    ], axis=1).max(axis=1)
    result["atr"] = tr.rolling(14).mean()

    # EMA 20, 50, 200
    result["ema_short"] = close.ewm(span=20).mean()
    result["ema_mid"] = close.ewm(span=50).mean()
    result["ema_long"] = close.ewm(span=200).mean()

    # RSI Divergence (simplified)
    price_highs = close.rolling(14).max() == close
    rsi_highs = result["rsi"].rolling(14).max() == result["rsi"]
    result["rsi_divergence"] = (price_highs & ~rsi_highs).astype(float)

    # MACD zero distance
    result["macd_zero_dist"] = result["macd"] / result["atr"].replace(0, np.nan)

    return result
