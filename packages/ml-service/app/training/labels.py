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


def generate_specialist_labels(trades: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """Generate confidence and size labels from trade outcomes."""
    confidence = []
    sizes = []

    for t in trades:
        pl = t.get("pl", 0)
        sl = t.get("stopLoss", 0)
        tp = t.get("takeProfit", 0)
        entry = t.get("entryPrice", 0)

        if entry == 0:
            confidence.append(0.5)
            sizes.append(1.0)
            continue

        exit_price = t.get("exitPrice", entry)
        expected_pips = abs(tp - entry) if tp else abs(sl - entry)

        # Confidence: 1.0 if hit TP, 0.0 if hit SL
        if tp and abs(exit_price - tp) < 0.0001:
            confidence.append(1.0)
        elif sl and abs(exit_price - sl) < 0.0001:
            confidence.append(0.0)
        else:
            confidence.append(0.5)

        # Size: actual P/L vs expected, clamped [0.5, 2.0]
        actual_pips = abs(exit_price - entry)
        ratio = actual_pips / expected_pips if expected_pips > 0 else 1.0
        sizes.append(max(0.5, min(2.0, ratio)))

    return np.array(confidence), np.array(sizes)
