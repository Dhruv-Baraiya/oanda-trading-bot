import { useState, useEffect, useCallback } from 'react';
import type { Trade } from '../services/api';
import { onTradesUpdate, requestRefresh } from '../services/socket';

export function useTrades() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onTradesUpdate((data) => {
      setTrades(data);
      setError(null);
    });
    return unsub;
  }, []);

  const refresh = useCallback(() => {
    requestRefresh();
  }, []);

  return { trades, error, refresh };
}
