import { closeTrade, type Trade } from '../../services/api';

interface Props {
  trades: Trade[];
  onTradeAction: () => void;
}

export function TradeList({ trades, onTradeAction }: Props) {
  const handleClose = async (tradeId: string) => {
    try {
      await closeTrade(tradeId);
      onTradeAction();
    } catch (err: any) {
      alert(`Failed to close trade: ${err.message}`);
    }
  };

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>Open Trades ({trades.length})</h3>
      {trades.length === 0 ? (
        <div style={styles.empty}>No open trades</div>
      ) : (
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>ID</th>
              <th style={styles.th}>Pair</th>
              <th style={styles.th}>Units</th>
              <th style={styles.th}>Entry</th>
              <th style={styles.th}>P&L</th>
              <th style={styles.th}>Action</th>
            </tr>
          </thead>
          <tbody>
            {trades.map(t => (
              <tr key={t.tradeId}>
                <td style={styles.td}>{t.tradeId}</td>
                <td style={styles.td}>{t.instrument}</td>
                <td style={{ ...styles.td, color: t.units > 0 ? '#26a69a' : '#ef5350' }}>
                  {t.units > 0 ? `+${t.units}` : t.units}
                </td>
                <td style={styles.td}>{t.price.toFixed(5)}</td>
                <td style={{ ...styles.td, color: t.unrealizedPL >= 0 ? '#26a69a' : '#ef5350' }}>
                  {t.unrealizedPL.toFixed(4)}
                </td>
                <td style={styles.td}>
                  <button style={styles.closeBtn} onClick={() => handleClose(t.tradeId)}>
                    Close
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { background: '#16213e', borderRadius: 8, padding: 16, marginBottom: 12 },
  title: { margin: '0 0 12px', color: '#d1d4dc', fontSize: 16 },
  empty: { color: '#8a8a9a', fontSize: 13 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { color: '#8a8a9a', fontSize: 11, textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid #2a2a3e' },
  td: { color: '#d1d4dc', fontSize: 13, padding: '6px 8px', borderBottom: '1px solid #2a2a3e' },
  closeBtn: {
    background: '#ef5350', color: '#fff', border: 'none', borderRadius: 4,
    padding: '4px 10px', cursor: 'pointer', fontSize: 12,
  },
};
