import numpy as np
import pandas as pd
from app.features.indicators import compute_indicators
from app.features.microstructure import compute_microstructure
from app.features.normalizer import RollingNormalizer


class FeatureExtractor:
    def __init__(self, lookback: int = 60):
        self.lookback = lookback
        self.normalizer = RollingNormalizer(window=252)

    def extract(
        self,
        h1: pd.DataFrame,
        m1: pd.DataFrame | None = None,
        m15: pd.DataFrame | None = None,
        h4: pd.DataFrame | None = None,
        sentiment: pd.DataFrame | None = None,
    ) -> np.ndarray:
        """Build feature matrix from multi-timeframe candles.
        Returns shape (num_samples, lookback, num_features).
        Only includes feature groups with actual data to avoid zero-noise."""

        # Group A: Base OHLCV (5 features) — always present
        base = self._base_features(h1)

        # Group B: Technical Indicators (15 features) — always present
        indicators = compute_indicators(h1)

        # Group F: Time/Session (7 features) — always present
        time_feat = self._time_features(h1)

        groups = [base, indicators, time_feat]

        # Group C: M1 Microstructure (8 features) — only if sufficient M1 data
        if m1 is not None and len(m1) > 500:
            groups.append(compute_microstructure(h1, m1))

        # Group D: M15 Momentum (4 features) — only if sufficient M15 data
        if m15 is not None and len(m15) > 100:
            groups.append(self._m15_momentum(h1, m15))

        # Group E: H4 Context (4 features) — only if sufficient H4 data
        if h4 is not None and len(h4) > 50:
            groups.append(self._h4_context(h1, h4))

        # Group G: Sentiment (3 features) — only if enough snapshots
        if sentiment is not None and len(sentiment) > 100:
            groups.append(self._sentiment_features(h1, sentiment))

        all_features = pd.concat(groups, axis=1)
        all_features = all_features.fillna(0)

        normalized = self.normalizer.transform(all_features)
        return self._build_windows(normalized)

    def _base_features(self, df: pd.DataFrame) -> pd.DataFrame:
        result = pd.DataFrame(index=df.index)
        result["log_return"] = np.log(df["close"] / df["close"].shift(1))
        result["high_low_range"] = (df["high"] - df["low"]) / df["close"]
        result["close_ref"] = df["close"]
        result["volume_delta"] = df["volume"].pct_change()
        result["open_close_diff"] = (df["close"] - df["open"]) / df["close"]
        return result

    def _m15_momentum(self, h1: pd.DataFrame, m15: pd.DataFrame) -> pd.DataFrame:
        cols = ["m15_ret_1", "m15_ret_2", "m15_ret_3", "m15_ret_4",
                "m15_vol_ratio", "m15_range_ratio"]
        result = pd.DataFrame(np.zeros((len(h1), 6)), index=h1.index, columns=cols)
        m15_returns = m15["close"].pct_change().values
        m15_idx = m15.index.values
        m15_vol = m15["volume"].values
        m15_range = ((m15["high"] - m15["low"]) / m15["close"]).values
        h1_idx = h1.index.values

        for i in range(len(h1_idx)):
            mask = m15_idx < h1_idx[i]
            valid = mask.sum()
            if valid < 5:
                continue
            start = max(0, valid - 4)
            rets = m15_returns[start:valid]
            for j in range(len(rets)):
                result.iloc[i, j] = rets[-(j + 1)] if j < len(rets) else 0
            recent_vol = m15_vol[max(0, valid - 4):valid]
            older_vol = m15_vol[max(0, valid - 20):max(0, valid - 4)]
            result.iloc[i, 4] = recent_vol.mean() / older_vol.mean() if len(older_vol) > 0 and older_vol.mean() > 0 else 1.0
            recent_range = m15_range[max(0, valid - 4):valid]
            result.iloc[i, 5] = recent_range.mean()

        return result

    def _h4_context(self, h1: pd.DataFrame, h4: pd.DataFrame) -> pd.DataFrame:
        result = pd.DataFrame(np.zeros((len(h1), 4)), index=h1.index, columns=["h4_position", "h4_trend", "h4_rsi", "h4_atr_ratio"])

        h4_ema20 = h4["close"].ewm(span=20).mean()
        h4_ema50 = h4["close"].ewm(span=50).mean()
        h4_range = h4["high"] - h4["low"]

        h1_atr = (h1["high"] - h1["low"]).rolling(14).mean()

        for i, ts in enumerate(h1.index):
            h4_prior = h4[h4.index <= ts]
            if len(h4_prior) < 2:
                continue
            last = h4_prior.iloc[-1]
            idx = h4_prior.index[-1]
            h_range = last["high"] - last["low"]
            result.iloc[i, 0] = (h1.iloc[i]["close"] - last["low"]) / h_range if h_range > 0 else 0.5
            result.iloc[i, 1] = 1.0 if h4_ema20.get(idx, 0) > h4_ema50.get(idx, 0) else -1.0
            # Simplified RSI for H4
            changes = h4_prior["close"].diff().tail(14)
            gains = changes[changes > 0].sum()
            losses = abs(changes[changes < 0].sum())
            result.iloc[i, 2] = (gains / (gains + losses)) * 100 if (gains + losses) > 0 else 50
            h4_atr = h4_range.tail(14).mean()
            result.iloc[i, 3] = h4_atr / h1_atr.iloc[i] if h1_atr.iloc[i] > 0 else 1.0

        return result

    def _time_features(self, df: pd.DataFrame) -> pd.DataFrame:
        result = pd.DataFrame(index=df.index)
        hours = df.index.hour
        weekdays = df.index.weekday

        result["hour_sin"] = np.sin(2 * np.pi * hours / 24)
        result["hour_cos"] = np.cos(2 * np.pi * hours / 24)
        result["day_sin"] = np.sin(2 * np.pi * weekdays / 5)
        result["day_cos"] = np.cos(2 * np.pi * weekdays / 5)
        result["session_asian"] = ((hours >= 0) & (hours < 8)).astype(float)
        result["session_london"] = ((hours >= 8) & (hours < 16)).astype(float)
        result["session_ny"] = ((hours >= 13) & (hours < 21)).astype(float)

        return result

    def _sentiment_features(self, h1: pd.DataFrame, sentiment: pd.DataFrame) -> pd.DataFrame:
        result = pd.DataFrame(np.zeros((len(h1), 3)), index=h1.index, columns=["long_ratio", "net_change", "extreme"])

        for i, ts in enumerate(h1.index):
            prior = sentiment[sentiment.index <= ts]
            if len(prior) == 0:
                continue
            latest = prior.iloc[-1]
            result.iloc[i, 0] = latest["longRatio"]
            if len(prior) >= 2:
                result.iloc[i, 1] = latest["longRatio"] - prior.iloc[-2]["longRatio"]
            result.iloc[i, 2] = 1.0 if latest["longRatio"] > 0.7 or latest["longRatio"] < 0.3 else 0.0

        return result

    def _build_windows(self, data: np.ndarray) -> np.ndarray:
        if len(data) < self.lookback:
            return np.array([]).reshape(0, self.lookback, data.shape[1])

        windows = []
        for i in range(self.lookback, len(data)):
            windows.append(data[i - self.lookback:i])

        return np.array(windows)
