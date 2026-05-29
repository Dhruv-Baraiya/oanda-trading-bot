import { useState, useEffect } from 'react';
import {
  fetchStrategies,
  fetchBacktestResults,
  fetchBacktestResult,
  runBacktest,
  deleteBacktestResult,
  type Strategy,
  type BacktestResult,
  type BacktestSummary,
} from '../../services/api';
import { EquityCurveChart } from './EquityCurveChart';
import { MetricsPanel } from './MetricsPanel';
import { BacktestTradeList } from './BacktestTradeList';

export function BacktestPanel() {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [results, setResults] = useState<BacktestSummary[]>([]);
  const [selectedResult, setSelectedResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [strategyId, setStrategyId] = useState('');
  const [fromDate, setFromDate] = useState('2024-01-01');
  const [toDate, setToDate] = useState('2024-12-31');
  const [balance, setBalance] = useState(10000);
  const [spreadPips, setSpreadPips] = useState(1.0);
  const [slippagePips, setSlippagePips] = useState(0.3);

  useEffect(() => {
    fetchStrategies().then(list => {
      setStrategies(list);
      if (list.length > 0 && !strategyId) setStrategyId(list[0]._id);
    }).catch(() => {});
    fetchBacktestResults().then(setResults).catch(() => {});
  }, []);

  const handleRun = async () => {
    if (!strategyId) return;
    setRunning(true);
    setError(null);
    setSelectedResult(null);
    try {
      const result = await runBacktest({
        strategyId,
        from: fromDate,
        to: toDate,
        initialBalance: balance,
        spreadPips,
        slippagePips,
      });
      setSelectedResult(result);
      fetchBacktestResults().then(setResults).catch(() => {});
    } catch (err: any) {
      setError(err.response?.data?.error ?? err.message);
    } finally {
      setRunning(false);
    }
  };

  const handleViewResult = async (id: string) => {
    try {
      const result = await fetchBacktestResult(id);
      setSelectedResult(result);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteBacktestResult(id);
      setResults(prev => prev.filter(r => r._id !== id));
      if (selectedResult?._id === id) setSelectedResult(null);
    } catch {}
  };

  if (selectedResult) {
    return (
      <div style={styles.container}>
        <div style={styles.headerRow}>
          <h3 style={styles.title}>
            {selectedResult.strategyName} — {selectedResult.instrument}
          </h3>
          <button style={styles.backBtn} onClick={() => setSelectedResult(null)}>Back</button>
        </div>

        <EquityCurveChart equityCurve={selectedResult.equityCurve} height={220} />
        <MetricsPanel
          metrics={selectedResult.metrics}
          startBalance={selectedResult.startBalance}
          endBalance={selectedResult.endBalance}
        />
        <BacktestTradeList trades={selectedResult.trades} />
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>Backtest</h3>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.form}>
        <label style={styles.label}>Strategy</label>
        <select style={styles.select} value={strategyId} onChange={e => setStrategyId(e.target.value)}>
          {strategies.map(s => (
            <option key={s._id} value={s._id}>{s.name} ({s.instrument})</option>
          ))}
        </select>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>From</label>
            <input style={styles.input} type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>To</label>
            <input style={styles.input} type="date" value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>Balance ($)</label>
            <input style={styles.input} type="number" value={balance}
              onChange={e => setBalance(parseInt(e.target.value) || 10000)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>Spread (pips)</label>
            <input style={styles.input} type="number" step="0.1" value={spreadPips}
              onChange={e => setSpreadPips(parseFloat(e.target.value) || 1.0)} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>Slippage (pips)</label>
            <input style={styles.input} type="number" step="0.1" value={slippagePips}
              onChange={e => setSlippagePips(parseFloat(e.target.value) || 0.3)} />
          </div>
        </div>

        <button style={styles.runBtn} onClick={handleRun} disabled={running || !strategyId}>
          {running ? 'Running...' : 'Run Backtest'}
        </button>
      </div>

      {results.length > 0 && (
        <div style={styles.history}>
          <h4 style={styles.subtitle}>History</h4>
          {results.map(r => (
            <div key={r._id} style={styles.resultCard}>
              <div style={styles.resultTop}>
                <span style={styles.resultName}>{r.strategyName}</span>
                <span style={styles.resultMeta}>
                  {r.instrument} · {new Date(r.runAt).toLocaleDateString()}
                </span>
              </div>
              <div style={styles.resultStats}>
                <span style={{ color: (r.metrics?.netProfit ?? 0) >= 0 ? '#26a69a' : '#ef5350', fontSize: 12, fontWeight: 'bold' }}>
                  {(r.metrics?.netProfit ?? 0) >= 0 ? '+' : ''}${(r.metrics?.netProfit ?? 0).toFixed(2)}
                </span>
                <span style={{ color: '#8a8a9a', fontSize: 11 }}>
                  {r.metrics?.totalTrades ?? 0} trades · WR {((r.metrics?.winRate ?? 0) * 100).toFixed(0)}% · PF {(r.metrics?.profitFactor ?? 0).toFixed(2)}
                </span>
              </div>
              <div style={styles.resultActions}>
                <button style={styles.viewBtn} onClick={() => handleViewResult(r._id)}>View</button>
                <button style={styles.delBtn} onClick={() => handleDelete(r._id)}>Del</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { background: '#16213e', borderRadius: 8, padding: 16, marginBottom: 12, maxHeight: 700, overflowY: 'auto' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { margin: '0 0 12px', color: '#d1d4dc', fontSize: 16 },
  subtitle: { margin: '0 0 8px', color: '#d1d4dc', fontSize: 13 },
  backBtn: { background: '#555', color: '#fff', border: 'none', borderRadius: 4, padding: '5px 12px', cursor: 'pointer', fontSize: 12 },
  error: { color: '#ef5350', fontSize: 12, padding: 8, background: '#1a1a2e', borderRadius: 6, marginBottom: 8 },
  form: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 },
  label: { color: '#8a8a9a', fontSize: 11, display: 'block', marginBottom: 3 },
  select: { width: '100%', background: '#0f3460', color: '#d1d4dc', border: '1px solid #2a2a3e', borderRadius: 4, padding: '6px 8px', fontSize: 13 },
  input: { width: '100%', background: '#0f3460', color: '#d1d4dc', border: '1px solid #2a2a3e', borderRadius: 4, padding: '6px 8px', fontSize: 13, boxSizing: 'border-box' },
  runBtn: {
    background: '#2196f3', color: '#fff', border: 'none', borderRadius: 6, padding: '10px 0',
    cursor: 'pointer', fontSize: 14, fontWeight: 'bold', marginTop: 4,
  },
  history: { borderTop: '1px solid #2a2a3e', paddingTop: 12 },
  resultCard: { background: '#0d1b3e', borderRadius: 6, padding: 10, marginBottom: 8 },
  resultTop: { display: 'flex', justifyContent: 'space-between', marginBottom: 4 },
  resultName: { color: '#d1d4dc', fontSize: 13, fontWeight: 'bold' },
  resultMeta: { color: '#8a8a9a', fontSize: 11 },
  resultStats: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  resultActions: { display: 'flex', gap: 6 },
  viewBtn: { background: 'transparent', color: '#2196f3', border: '1px solid #2a2a3e', borderRadius: 3, padding: '3px 10px', cursor: 'pointer', fontSize: 11 },
  delBtn: { background: 'transparent', color: '#ef5350', border: '1px solid #2a2a3e', borderRadius: 3, padding: '3px 10px', cursor: 'pointer', fontSize: 11 },
};
