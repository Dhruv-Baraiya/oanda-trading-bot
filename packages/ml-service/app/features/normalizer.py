import numpy as np
import pandas as pd


class RollingNormalizer:
    """Rolling z-score for price features, min-max for bounded features."""

    BOUNDED_COLS = {"rsi", "bb_percentB", "long_ratio", "close_position", "h4_rsi"}
    BINARY_COLS = {"session_asian", "session_london", "session_ny", "extreme", "rsi_divergence"}
    CYCLIC_COLS = {"hour_sin", "hour_cos", "day_sin", "day_cos"}

    def __init__(self, window: int = 252):
        self.window = window

    def transform(self, df: pd.DataFrame) -> np.ndarray:
        result = pd.DataFrame(index=df.index, columns=df.columns, dtype=float)

        for col in df.columns:
            series = df[col].astype(float)

            if col in self.BINARY_COLS or col in self.CYCLIC_COLS:
                result[col] = series
            elif col in self.BOUNDED_COLS:
                col_min = series.rolling(self.window, min_periods=1).min()
                col_max = series.rolling(self.window, min_periods=1).max()
                denom = (col_max - col_min).replace(0, 1)
                result[col] = (series - col_min) / denom
            else:
                mean = series.rolling(self.window, min_periods=1).mean()
                std = series.rolling(self.window, min_periods=1).std().replace(0, 1)
                result[col] = (series - mean) / std

        return result.fillna(0).values
