import { useState } from 'react';
import { activateKillSwitch } from '../../services/api';

interface Props {
  onActivated: () => void;
}

export function KillSwitch({ onActivated }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const handleClick = () => {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 5000);
      return;
    }
    doKill();
  };

  const doKill = async () => {
    setLoading(true);
    try {
      const data = await activateKillSwitch();
      setResult(`Closed ${data.closedTrades} trades in ${data.elapsedMs}ms`);
      onActivated();
    } catch (err: any) {
      setResult(`Error: ${err.message}`);
    } finally {
      setLoading(false);
      setConfirming(false);
      setTimeout(() => setResult(null), 5000);
    }
  };

  return (
    <div style={styles.container}>
      <button
        style={{
          ...styles.button,
          background: confirming ? '#b71c1c' : '#ef5350',
          opacity: loading ? 0.6 : 1,
        }}
        onClick={handleClick}
        disabled={loading}
      >
        {loading ? 'CLOSING ALL...' : confirming ? 'CONFIRM KILL' : 'KILL SWITCH'}
      </button>
      {result && <div style={styles.result}>{result}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { textAlign: 'center', marginBottom: 12 },
  button: {
    width: '100%', padding: '16px 24px', fontSize: 18, fontWeight: 'bold',
    color: '#fff', border: '2px solid #b71c1c', borderRadius: 8,
    cursor: 'pointer', letterSpacing: 2,
  },
  result: { color: '#ffeb3b', fontSize: 12, marginTop: 8 },
};
