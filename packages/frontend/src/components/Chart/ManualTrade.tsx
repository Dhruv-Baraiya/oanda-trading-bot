import { useState } from 'react';
import { placeOrder } from '../../services/api';

interface Props {
  instrument: string;
  onOrderPlaced: () => void;
}

export function ManualTrade({ instrument, onOrderPlaced }: Props) {
  const [units, setUnits] = useState('100');
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const handleOrder = async (side: 'BUY' | 'SELL') => {
    const parsedUnits = parseInt(units);
    if (isNaN(parsedUnits) || parsedUnits <= 0) {
      alert('Enter valid positive units');
      return;
    }

    setLoading(true);
    try {
      const result = await placeOrder({
        instrument,
        units: side === 'BUY' ? parsedUnits : -parsedUnits,
        type: 'MARKET',
      });
      setLastResult(`${side} ${Math.abs(result.units)} @ ${result.price}`);
      onOrderPlaced();
    } catch (err: any) {
      setLastResult(`Error: ${err.message}`);
    } finally {
      setLoading(false);
      setTimeout(() => setLastResult(null), 5000);
    }
  };

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>Manual Trade — {instrument.replace('_', '/')}</h3>
      <div style={styles.row}>
        <label style={styles.label}>Units:</label>
        <input
          style={styles.input}
          type="number"
          min="1"
          value={units}
          onChange={e => setUnits(e.target.value)}
          disabled={loading}
        />
      </div>
      <div style={styles.btnRow}>
        <button
          style={{ ...styles.btn, background: '#26a69a' }}
          onClick={() => handleOrder('BUY')}
          disabled={loading}
        >
          BUY
        </button>
        <button
          style={{ ...styles.btn, background: '#ef5350' }}
          onClick={() => handleOrder('SELL')}
          disabled={loading}
        >
          SELL
        </button>
      </div>
      {lastResult && <div style={styles.result}>{lastResult}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { background: '#16213e', borderRadius: 8, padding: 16, marginBottom: 12 },
  title: { margin: '0 0 12px', color: '#d1d4dc', fontSize: 16 },
  row: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 },
  label: { color: '#8a8a9a', fontSize: 13 },
  input: {
    flex: 1, background: '#0f3460', border: '1px solid #2a2a3e', borderRadius: 4,
    color: '#d1d4dc', padding: '8px 12px', fontSize: 14,
  },
  btnRow: { display: 'flex', gap: 12 },
  btn: {
    flex: 1, padding: '12px', fontSize: 16, fontWeight: 'bold',
    color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
  },
  result: { color: '#ffeb3b', fontSize: 12, marginTop: 8, textAlign: 'center' },
};
