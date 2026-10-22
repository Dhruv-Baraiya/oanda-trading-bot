import numpy as np
import pandas as pd


REGIME_TRENDING = 1
REGIME_RANGING = 0
REGIME_CHOPPY = -1


def classify_regime(df: pd.DataFrame) -> np.ndarray:
    """Rule-based regime classification using ADX, EMA alignment, ATR ratio.
    Returns array of regime labels aligned with df index."""
    close = df["close"]
    high = df["high"]
    low = df["low"]

    tr = pd.concat([
        high - low,
        (high - close.shift(1)).abs(),
        (low - close.shift(1)).abs(),
    ], axis=1).max(axis=1)
    atr_14 = tr.rolling(14).mean()
    atr_50 = tr.rolling(50).mean().replace(0, np.nan)
    atr_ratio = atr_14 / atr_50

    plus_dm = high.diff()
    minus_dm = -low.diff()
    plus_dm = plus_dm.where((plus_dm > minus_dm) & (plus_dm > 0), 0)
    minus_dm = minus_dm.where((minus_dm > plus_dm) & (minus_dm > 0), 0)
    atr_safe = atr_14.replace(0, np.nan)
    plus_di = 100 * (plus_dm.ewm(span=14).mean() / atr_safe)
    minus_di = 100 * (minus_dm.ewm(span=14).mean() / atr_safe)
    dx = (100 * (plus_di - minus_di).abs() / (plus_di + minus_di).replace(0, np.nan))
    adx = dx.ewm(span=14).mean()

    ema_20 = close.ewm(span=20).mean()
    ema_50 = close.ewm(span=50).mean()
    ema_200 = close.ewm(span=200).mean()
    ema_align = (
        (ema_20 > ema_50).astype(float)
        + (ema_50 > ema_200).astype(float)
        + (close > ema_20).astype(float)
    ) - 1.5

    regime = np.full(len(df), REGIME_CHOPPY)

    trending = (adx > 25) & (ema_align.abs() > 0.5)
    ranging = (adx < 20) & (atr_ratio < 1.1)

    regime[trending.values] = REGIME_TRENDING
    regime[ranging.values] = REGIME_RANGING

    return regime


def regime_label(code: int) -> str:
    return {REGIME_TRENDING: "trending", REGIME_RANGING: "ranging", REGIME_CHOPPY: "choppy"}[code]
