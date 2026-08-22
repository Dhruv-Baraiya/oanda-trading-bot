import numpy as np
import pandas as pd
from app.features.indicators import compute_indicators


class FlatFeatureExtractor:
    """Extracts flat feature vectors (1 row per candle) for tree-based models."""

    def extract(self, df: pd.DataFrame) -> pd.DataFrame:
        parts = [
            self._price_features(df),
            compute_indicators(df),
            self._lagged_returns(df),
            self._rolling_stats(df),
            self._price_action(df),
            self._time_features(df),
        ]
        result = pd.concat(parts, axis=1)
        result = result.replace([np.inf, -np.inf], np.nan).fillna(0)
        return result

    def _price_features(self, df: pd.DataFrame) -> pd.DataFrame:
        r = pd.DataFrame(index=df.index)
        r["log_return"] = np.log(df["close"] / df["close"].shift(1))
        r["high_low_range"] = (df["high"] - df["low"]) / df["close"]
        r["volume_delta"] = df["volume"].pct_change()
        r["open_close_diff"] = (df["close"] - df["open"]) / df["close"]
        return r

    def _lagged_returns(self, df: pd.DataFrame) -> pd.DataFrame:
        r = pd.DataFrame(index=df.index)
        close = df["close"]
        for lag in [1, 2, 3, 5, 10, 20]:
            r[f"ret_lag_{lag}"] = close.pct_change(lag)
        return r

    def _rolling_stats(self, df: pd.DataFrame) -> pd.DataFrame:
        r = pd.DataFrame(index=df.index)
        returns = df["close"].pct_change()
        for w in [5, 10, 20, 50]:
            r[f"ret_mean_{w}"] = returns.rolling(w).mean()
            r[f"ret_std_{w}"] = returns.rolling(w).std()
        atr = (df["high"] - df["low"]).rolling(14).mean()
        r["atr_pct_rank"] = atr.rolling(100).rank(pct=True)
        r["vol_ma_ratio"] = df["volume"] / df["volume"].rolling(20).mean().replace(0, np.nan)
        return r

    def _price_action(self, df: pd.DataFrame) -> pd.DataFrame:
        r = pd.DataFrame(index=df.index)
        o, h, l, c = df["open"], df["high"], df["low"], df["close"]
        body = (c - o).abs()
        full_range = (h - l).replace(0, np.nan)

        r["body_ratio"] = (body / full_range).fillna(0)
        r["upper_wick"] = ((h - pd.concat([o, c], axis=1).max(axis=1)) / full_range).fillna(0)
        r["lower_wick"] = ((pd.concat([o, c], axis=1).min(axis=1) - l) / full_range).fillna(0)

        roll_high = h.rolling(20).max()
        roll_low = l.rolling(20).min()
        roll_range = (roll_high - roll_low).replace(0, np.nan)
        r["dist_to_high"] = ((roll_high - c) / roll_range).fillna(0.5)
        r["dist_to_low"] = ((c - roll_low) / roll_range).fillna(0.5)

        direction = (c > o).astype(int)
        streaks = direction.groupby((direction != direction.shift()).cumsum()).cumcount() + 1
        r["consec_dir"] = streaks * direction.map({1: 1, 0: -1})

        r["gap"] = ((o - c.shift(1)) / (h - l).rolling(14).mean().replace(0, np.nan)).fillna(0).clip(-3, 3)

        return r

    def _time_features(self, df: pd.DataFrame) -> pd.DataFrame:
        r = pd.DataFrame(index=df.index)
        hours = df.index.hour
        weekdays = df.index.weekday

        r["hour_sin"] = np.sin(2 * np.pi * hours / 24)
        r["hour_cos"] = np.cos(2 * np.pi * hours / 24)
        r["day_sin"] = np.sin(2 * np.pi * weekdays / 5)
        r["day_cos"] = np.cos(2 * np.pi * weekdays / 5)
        r["session_london"] = ((hours >= 8) & (hours < 16)).astype(float)
        r["session_ny"] = ((hours >= 13) & (hours < 21)).astype(float)
        return r

    def get_feature_names(self, df: pd.DataFrame) -> list[str]:
        return self.extract(df).columns.tolist()
