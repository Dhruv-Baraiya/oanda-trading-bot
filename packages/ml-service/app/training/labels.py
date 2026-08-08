import numpy as np
import pandas as pd


def generate_direction_labels(
    h1: pd.DataFrame,
    horizon: int = 6,
    threshold_atr_mult: float = 0.5,
) -> tuple[np.ndarray, np.ndarray]:
    """Generate direction (3-class) and magnitude labels for universal model.
    Returns (direction_onehot, magnitude) aligned with h1 index."""

    close = h1["close"].values
    tr = np.maximum(
        h1["high"].values - h1["low"].values,
        np.maximum(
            np.abs(h1["high"].values - np.roll(close, 1)),
            np.abs(h1["low"].values - np.roll(close, 1)),
        ),
    )
    atr = pd.Series(tr).rolling(14).mean().values

    n = len(close)
    directions = np.zeros((n, 3))  # [UP, DOWN, FLAT]
    magnitudes = np.zeros(n)

    for i in range(n - horizon):
        future_return = (close[i + horizon] - close[i]) / close[i]
        threshold = threshold_atr_mult * atr[i] if atr[i] > 0 else 0.001

        if future_return > threshold:
            directions[i] = [1, 0, 0]  # UP
        elif future_return < -threshold:
            directions[i] = [0, 1, 0]  # DOWN
        else:
            directions[i] = [0, 0, 1]  # FLAT

        magnitudes[i] = future_return / atr[i] if atr[i] > 0 else 0

    # Trim last `horizon` rows (no future data)
    valid = n - horizon
    return directions[:valid], magnitudes[:valid]


def generate_specialist_labels_from_trades(trades: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """Generate confidence and size labels from actual trade outcomes."""
    confidence = []
    sizes = []

    for t in trades:
        sl = t.get("stopLoss", 0)
        tp = t.get("takeProfit", 0)
        entry = t.get("entryPrice", 0)

        if entry == 0:
            confidence.append(0.5)
            sizes.append(1.0)
            continue

        exit_price = t.get("exitPrice", entry)
        expected_pips = abs(tp - entry) if tp else abs(sl - entry)

        if tp and abs(exit_price - tp) < 0.0001:
            confidence.append(1.0)
        elif sl and abs(exit_price - sl) < 0.0001:
            confidence.append(0.0)
        else:
            confidence.append(0.5)

        actual_pips = abs(exit_price - entry)
        ratio = actual_pips / expected_pips if expected_pips > 0 else 1.0
        sizes.append(max(0.5, min(2.0, ratio)))

    return np.array(confidence), np.array(sizes)


def generate_specialist_labels_synthetic(
    h1: pd.DataFrame,
    horizon: int = 6,
    sl_atr_mult: float = 1.5,
    tp_ratio: float = 2.0,
) -> tuple[np.ndarray, np.ndarray]:
    """Generate synthetic confidence/size labels by simulating trades on each candle."""
    close = h1["close"].values
    high = h1["high"].values
    low = h1["low"].values

    tr = np.maximum(
        high - low,
        np.maximum(np.abs(high - np.roll(close, 1)), np.abs(low - np.roll(close, 1))),
    )
    atr = pd.Series(tr).rolling(14).mean().values

    n = len(close)
    confidence = np.full(n, 0.5)
    optimal_size = np.full(n, 0.5)

    for i in range(14, n - horizon):
        if atr[i] <= 0:
            continue

        sl_dist = atr[i] * sl_atr_mult
        tp_dist = sl_dist * tp_ratio
        entry = close[i]

        # Simulate long trade
        long_hit_tp = False
        long_hit_sl = False
        for j in range(1, horizon + 1):
            if i + j >= n:
                break
            if high[i + j] >= entry + tp_dist:
                long_hit_tp = True
                break
            if low[i + j] <= entry - sl_dist:
                long_hit_sl = True
                break

        # Simulate short trade
        short_hit_tp = False
        short_hit_sl = False
        for j in range(1, horizon + 1):
            if i + j >= n:
                break
            if low[i + j] <= entry - tp_dist:
                short_hit_tp = True
                break
            if high[i + j] >= entry + sl_dist:
                short_hit_sl = True
                break

        # Best outcome determines confidence
        if long_hit_tp or short_hit_tp:
            confidence[i] = 1.0
            move = abs(close[min(i + horizon, n - 1)] - entry)
            optimal_size[i] = min(1.0, move / (atr[i] * 2)) + 0.5
        elif long_hit_sl and short_hit_sl:
            confidence[i] = 0.0
            optimal_size[i] = 0.3
        else:
            move = abs(close[min(i + horizon, n - 1)] - entry)
            confidence[i] = min(1.0, move / tp_dist) * 0.7 + 0.15
            optimal_size[i] = 0.5

    valid = n - horizon
    return confidence[:valid], optimal_size[:valid]
