import numpy as np
import pandas as pd


def compute_microstructure(h1: pd.DataFrame, m1: pd.DataFrame) -> pd.DataFrame:
    """Compute 8 M1 microstructure features per H1 candle — vectorized."""
    columns = [
        "intra_volatility", "intra_reversals", "intra_max_drawdown",
        "intra_trend_strength", "early_vs_late", "intra_volume_skew",
        "close_position", "momentum_acceleration",
    ]
    result = pd.DataFrame(np.zeros((len(h1), 8)), index=h1.index, columns=columns)

    if len(m1) < 10:
        return result

    m1_returns = m1["close"].pct_change()
    m1_signs = np.sign(m1_returns)

    m1_hourly = m1.resample("1h")

    # 1. Intra-hour volatility
    vol = m1_returns.resample("1h").std()

    # 2. Reversals (sign changes per hour)
    def count_reversals(signs):
        if len(signs) < 2:
            return 0
        v = signs.dropna().values
        if len(v) < 2:
            return 0
        return int(np.sum(v[1:] != v[:-1]))

    reversals = m1_signs.resample("1h").apply(count_reversals)

    # 3. Max drawdown per hour
    def max_drawdown(closes):
        if len(closes) < 2:
            return 0.0
        rets = closes.pct_change().dropna()
        if len(rets) == 0:
            return 0.0
        cum = (1 + rets).cumprod()
        peak = cum.expanding().max()
        dd = (cum - peak) / peak
        return float(dd.min())

    drawdowns = m1_hourly["close"].apply(max_drawdown)

    # 4. Trend strength: abs(net return) / sum(abs returns)
    abs_ret_sum = m1_returns.abs().resample("1h").sum()
    first_close = m1_hourly["close"].first()
    last_close = m1_hourly["close"].last()
    net_ret = ((last_close - first_close) / first_close).abs()
    trend = net_ret / abs_ret_sum.replace(0, np.nan)
    trend = trend.fillna(0)

    # 5. Early vs late: return of first half minus return of second half
    def early_vs_late(closes):
        if len(closes) < 4:
            return 0.0
        mid = len(closes) // 2
        c = closes.values
        early = c[mid] / c[0] - 1 if c[0] > 0 else 0
        late = c[-1] / c[mid] - 1 if c[mid] > 0 else 0
        return float(early - late)

    evl = m1_hourly["close"].apply(early_vs_late)

    # 6. Volume skew: max volume / mean volume per hour
    vol_max = m1_hourly["volume"].max()
    vol_mean = m1_hourly["volume"].mean()
    vol_skew = vol_max / vol_mean.replace(0, 1)

    # 7. Close position within range
    range_high = m1_hourly["high"].max()
    range_low = m1_hourly["low"].min()
    h_range = range_high - range_low
    close_pos = (last_close - range_low) / h_range.replace(0, np.nan)
    close_pos = close_pos.fillna(0.5)

    # 8. Momentum acceleration (slope of returns)
    def momentum_accel(rets):
        v = rets.dropna().values
        if len(v) < 2:
            return 0.0
        x = np.arange(len(v))
        return float(np.polyfit(x, v, 1)[0])

    accel = m1_returns.resample("1h").apply(momentum_accel)

    # Combine all into one DataFrame
    hourly_features = pd.DataFrame({
        "intra_volatility": vol,
        "intra_reversals": reversals,
        "intra_max_drawdown": drawdowns,
        "intra_trend_strength": trend,
        "early_vs_late": evl,
        "intra_volume_skew": vol_skew,
        "close_position": close_pos,
        "momentum_acceleration": accel,
    })

    # Align with H1 index
    for col in columns:
        if col in hourly_features.columns:
            aligned = hourly_features[col].reindex(h1.index, method="ffill")
            result[col] = aligned.fillna(0).values

    return result
