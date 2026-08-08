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
        Returns shape (num_samples, lookback, num_features)."""

        # Group A: Base OHLCV (5 features)
        base = self._base_features(h1)

        # Group B: Technical Indicators (15 features)
        indicators = compute_indicators(h1)

        # Group C: M1 Microstructure (8 features)
        micro = compute_microstructure(h1, m1) if m1 is not None and len(m1) > 0 else pd.DataFrame(
            np.zeros((len(h1), 8)),
            index=h1.index,
            columns=[f"micro_{i}" for i in range(8)],
        )

        # Group D: M15 Momentum (4 features)
        m15_feat = self._m15_momentum(h1, m15) if m15 is not None and len(m15) > 0 else pd.DataFrame(
            np.zeros((len(h1), 4)), index=h1.index, columns=[f"m15_ret_{i}" for i in range(4)]
        )

        # Group E: H4 Context (4 features)
        h4_feat = self._h4_context(h1, h4) if h4 is not None and len(h4) > 0 else pd.DataFrame(
            np.zeros((len(h1), 4)), index=h1.index, columns=[f"h4_{i}" for i in range(4)]
        )

        # Group F: Time/Session (7 features)
        time_feat = self._time_features(h1)

        # Group G: Sentiment (3 features)
        sent_feat = self._sentiment_features(h1, sentiment) if sentiment is not None and len(sentiment) > 0 else pd.DataFrame(
            np.zeros((len(h1), 3)), index=h1.index, columns=["long_ratio", "net_change", "extreme"]
        )

        # Group H: Currency Strength (3 features) — placeholder, computed separately
        strength = pd.DataFrame(
            np.zeros((len(h1), 3)), index=h1.index, columns=["base_strength", "quote_strength", "divergence"]
        )

        all_features = pd.concat([base, indicators, micro, m15_feat, h4_feat, time_feat, sent_feat, strength], axis=1)
        all_features = all_features.fillna(0)

        # Normalize
        normalized = self.normalizer.transform(all_features)

        # Build lookback windows
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
        result = pd.DataFrame(np.zeros((len(h1), 4)), index=h1.index, columns=["m15_ret_1", "m15_ret_2", "m15_ret_3", "m15_ret_4"])
        m15_returns = m15["close"].pct_change()

        for i, ts in enumerate(h1.index):
            prior = m15_returns[m15_returns.index < ts].tail(4)
            vals = prior.values
            for j in range(min(len(vals), 4)):
                result.iloc[i, j] = vals[-(j + 1)]

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
