"""Feature subsets for multi-question ensemble.
Each question model sees only features relevant to its judgment."""

MOMENTUM_FEATURES = [
    "rsi", "rsi_divergence", "stoch_k", "stoch_d",
    "macd_norm", "macd_signal_norm", "macd_hist_norm",
    "roc_5", "roc_10", "roc_20",
    "ret_lag_1", "ret_lag_2", "ret_lag_3", "ret_lag_5", "ret_lag_10", "ret_lag_20",
    "log_return", "open_close_diff",
    "obv_trend",
    "hour_sin", "hour_cos",
]

VOLATILITY_FEATURES = [
    "atr_pct", "atr_ratio", "atr_pct_rank", "bb_squeeze",
    "bb_percentB", "bb_width",
    "ret_std_5", "ret_std_10", "ret_std_20", "ret_std_50",
    "high_low_range",
    "vol_spike", "vol_trend", "vol_ma_ratio", "volume_delta",
    "inside_bar",
    "session_london", "session_ny",
]

TREND_FEATURES = [
    "ema_short_dist", "ema_mid_dist", "ema_long_dist",
    "ema_spread", "ema_alignment",
    "adx", "di_spread",
    "ret_mean_5", "ret_mean_10", "ret_mean_20", "ret_mean_50",
    "consec_dir",
    "hh_count", "ll_count",
    "dist_to_high", "dist_to_low",
    "dist_swing_high", "dist_swing_low",
    "engulfing_bull", "engulfing_bear",
    "zscore_20", "zscore_50", "overextension",
]

QUESTION_GROUPS = {
    "momentum": MOMENTUM_FEATURES,
    "volatility": VOLATILITY_FEATURES,
    "trend": TREND_FEATURES,
}


def get_feature_indices(all_names: list[str], group_names: list[str]) -> list[int]:
    name_to_idx = {n: i for i, n in enumerate(all_names)}
    return [name_to_idx[n] for n in group_names if n in name_to_idx]
