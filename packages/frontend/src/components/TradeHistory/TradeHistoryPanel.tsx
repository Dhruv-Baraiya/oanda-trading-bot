import { useState, useEffect } from 'react';
import { fetchTradeHistory, type TradeHistory } from '../../services/api';

export function TradeHistoryPanel() {
  const [trades, setTrades] = useState<TradeHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    fetchTradeHistory(100)
      .then(setTrades)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const closedTrades = trades.filter(t => t.state === 'CLOSED' && t.pl !== undefined);
  const totalPL = closedTrades.reduce((s, t) => s + (t.pl ?? 0), 0);
  const wins = closedTrades.filter(t => (t.pl ?? 0) > 0).length;
  const losses = closedTrades.filter(t => (t.pl ?? 0) < 0).length;
  const winRate = closedTrades.length > 0 ? (wins / closedTrades.length * 100) : 0;

  const fmt = (n: number) => n >= 0 ? `+$${n.toFixed(2)}` : `-$${Math.abs(n).toFixed(2)}`;
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  if (loading) return <div style={s.loading}>Loading trade history...</div>;
  if (error) return <div style={s.error}>{error}</div>;

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h3 style={s.title}>Trade History</h3>
        <button style={s.refreshBtn} onClick={load}>Refresh</button>
      </div>

      <div style={s.statsRow}>
        <div style={s.stat}>
          <span style={s.statLabel}>Total P/L</span>
          <span style={{ ...s.statValue, color: totalPL >= 0 ? '#4caf50' : '#ef5350' }}>{fmt(totalPL)}</span>
        </div>
        <div style={s.stat}>
          <span style={s.statLabel}>Win Rate</span>
          <span style={s.statValue}>{winRate.toFixed(1)}%</span>
        </div>
        <div style={s.stat}>
          <span style={s.statLabel}>W / L</span>
          <span style={s.statValue}>{wins} / {losses}</span>
        </div>
        <div style={s.stat}>
          <span style={s.statLabel}>Total</span>
          <span style={s.statValue}>{closedTrades.length}</span>
        </div>
      </div>

      <div style={s.tableWrap}>
        <table style={s.table}>
          <thead>
            <tr>
              <th style={s.th}>Date</th>
              <th style={s.th}>Pair</th>
              <th style={s.th}>Side</th>
              <th style={s.th}>Entry</th>
              <th style={s.th}>Exit</th>
              <th style={s.th}>P/L</th>
            </tr>
          </thead>
          <tbody>
            {closedTrades.map(t => (
              <tr key={t._id} style={s.tr}>
                <td style={s.td}>{fmtDate(t.openTime)}</td>
                <td style={s.td}>{t.instrument.replace('_', '/')}</td>
                <td style={{ ...s.td, color: t.units > 0 ? '#4caf50' : '#ef5350' }}>
                  {t.units > 0 ? 'BUY' : 'SELL'}
                </td>
                <td style={s.td}>{t.entryPrice.toFixed(5)}</td>
                <td style={s.td}>{t.exitPrice?.toFixed(5) ?? '—'}</td>
                <td style={{ ...s.td, color: (t.pl ?? 0) >= 0 ? '#4caf50' : '#ef5350', fontWeight: 'bold' }}>
                  {fmt(t.pl ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {closedTrades.length === 0 && <div style={s.empty}>No closed trades yet</div>}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { background: '#111128', borderRadius: 8, padding: 16 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { margin: 0, fontSize: 16, color: '#fff' },
  refreshBtn: {
    background: '#0f3460', color: '#d1d4dc', border: '1px solid #2a2a3e',
    borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 12,
  },
  statsRow: { display: 'flex', gap: 12, marginBottom: 16 },
  stat: {
    flex: 1, background: '#16213e', borderRadius: 6, padding: '8px 12px',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
  },
  statLabel: { fontSize: 10, color: '#8a8a9a', textTransform: 'uppercase', letterSpacing: 1 },
  statValue: { fontSize: 15, fontWeight: 'bold', color: '#fff', marginTop: 2 },
  tableWrap: { maxHeight: 400, overflowY: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: {
    textAlign: 'left', padding: '6px 8px', color: '#8a8a9a', borderBottom: '1px solid #2a2a3e',
    fontSize: 11, textTransform: 'uppercase', position: 'sticky', top: 0, background: '#111128',
  },
  tr: { borderBottom: '1px solid #1a1a2e' },
  td: { padding: '6px 8px', color: '#d1d4dc' },
  empty: { color: '#8a8a9a', textAlign: 'center', padding: 20 },
  loading: { color: '#8a8a9a', padding: 20, textAlign: 'center' },
  error: { color: '#ef5350', padding: 12, background: '#1a1a2e', borderRadius: 8 },
};
