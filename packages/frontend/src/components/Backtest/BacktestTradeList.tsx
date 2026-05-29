import type { BacktestTrade } from '../../services/api';

interface Props {
  trades: BacktestTrade[];
}

export function BacktestTradeList({ trades }: Props) {
  return (
    <div style={styles.container}>
      <h4 style={styles.title}>Trades ({trades.length})</h4>
      <div style={styles.list}>
        {trades.map(t => (
          <div key={t.id} style={styles.row}>
            <span style={{ color: t.direction === 'LONG' ? '#26a69a' : '#ef5350', fontWeight: 'bold', fontSize: 11, width: 45 }}>
              {t.direction}
            </span>
            <span style={styles.meta}>
              {new Date(t.entryTime).toLocaleDateString()}
            </span>
            <span style={styles.meta}>{t.entryPrice.toFixed(5)}</span>
            <span style={styles.meta}>{t.exitPrice.toFixed(5)}</span>
            <span style={{
              fontSize: 11, fontWeight: 'bold', width: 65, textAlign: 'right',
              color: t.pnl >= 0 ? '#26a69a' : '#ef5350',
            }}>
              {t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(2)}
            </span>
            <span style={{ fontSize: 10, color: '#8a8a9a', width: 55 }}>{t.exitReason.replace('_', ' ')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { background: '#0d1b3e', borderRadius: 6, padding: 12 },
  title: { margin: '0 0 8px', color: '#d1d4dc', fontSize: 14 },
  list: { maxHeight: 200, overflowY: 'auto' },
  row: { display: 'flex', gap: 6, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #16213e' },
  meta: { color: '#8a8a9a', fontSize: 11, flex: 1 },
};
