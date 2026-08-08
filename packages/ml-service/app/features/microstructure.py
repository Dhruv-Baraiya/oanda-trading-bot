import numpy as np
import pandas as pd


def compute_microstructure(h1: pd.DataFrame, m1: pd.DataFrame) -> pd.DataFrame:
    """Compute 8 M1 microstructure features per H1 candle."""
    columns = [
        "intra_volatility", "intra_reversals", "intra_max_drawdown",
        "intra_trend_strength", "early_vs_late", "intra_volume_skew",
        "close_position", "momentum_acceleration",
    ]
    result = pd.DataFrame(np.zeros((len(h1), 8)), index=h1.index, columns=columns)

    for i, ts in enumerate(h1.index):
        # Get M1 candles within this H1 window
        h1_start = ts - pd.Timedelta(hours=1)
        mask = (m1.index > h1_start) & (m1.index <= ts)
        window = m1[mask]

        if len(window) < 5:
            continue

        returns = window["close"].pct_change().dropna()
        if len(returns) == 0:
            continue

        # 1. Intra-hour volatility
        result.iloc[i, 0] = returns.std()

        # 2. Reversals (sign changes)
        signs = np.sign(returns.values)
        result.iloc[i, 1] = np.sum(signs[1:] != signs[:-1])

        # 3. Max drawdown
        cum = (1 + returns).cumprod()
        peak = cum.expanding().max()
        dd = (cum - peak) / peak
        result.iloc[i, 2] = dd.min()

        # 4. Trend strength
        total_abs = returns.abs().sum()
        h1_return = abs(window["close"].iloc[-1] / window["close"].iloc[0] - 1)
        result.iloc[i, 3] = h1_return / total_abs if total_abs > 0 else 0

        # 5. Early vs late
        mid = len(window) // 2
        early_ret = window["close"].iloc[mid] / window["close"].iloc[0] - 1 if window["close"].iloc[0] > 0 else 0
        late_ret = window["close"].iloc[-1] / window["close"].iloc[mid] - 1 if window["close"].iloc[mid] > 0 else 0
        result.iloc[i, 4] = early_ret - late_ret

        # 6. Volume skew
        mean_vol = window["volume"].mean()
        result.iloc[i, 5] = window["volume"].max() / mean_vol if mean_vol > 0 else 1

        # 7. Close position within range
        h_range = window["high"].max() - window["low"].min()
        result.iloc[i, 6] = (window["close"].iloc[-1] - window["low"].min()) / h_range if h_range > 0 else 0.5

        # 8. Momentum acceleration (slope of returns)
        x = np.arange(len(returns))
        if len(x) > 1:
            slope = np.polyfit(x, returns.values, 1)[0]
            result.iloc[i, 7] = slope

    return result
