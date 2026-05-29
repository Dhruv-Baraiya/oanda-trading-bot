import { useState, useEffect, useCallback } from 'react';
import type { AccountSummary } from '../services/api';
import { onAccountUpdate, requestRefresh } from '../services/socket';

export function useAccount() {
  const [account, setAccount] = useState<AccountSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAccountUpdate((data) => {
      setAccount(data);
      setError(null);
    });
    return unsub;
  }, []);

  const refresh = useCallback(() => {
    requestRefresh();
  }, []);

  return { account, error, refresh };
}
