import { useState, useEffect, useCallback } from 'react';
import { fetchCandles, fetchIndicators, type Candle, type IndicatorSnapshot } from '../services/api';

export function useCandles(instrument: string, granularity: string, count: number) {
  const [candles, setCandles] = useState<Candle[]>([]);
  const [indicators, setIndicators] = useState<IndicatorSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [c, ind] = await Promise.all([
        fetchCandles(instrument, granularity, count),
        fetchIndicators(instrument, granularity, count),
      ]);
      setCandles(c);
      setIndicators(ind);
    } catch (err: any) {
      setError(err.message ?? 'Failed to fetch candles');
    } finally {
      setLoading(false);
    }
  }, [instrument, granularity, count]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { candles, indicators, loading, error, refresh };
}
