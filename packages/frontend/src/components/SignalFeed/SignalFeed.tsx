import { useState, useEffect } from 'react';
import { fetchRecentSignals, reviewSignal, type SignalRecord } from '../../services/api';

export function SignalFeed() {
  const [signals, setSignals] = useState<SignalRecord[]>([]);

  const load = async () => {
    try {
      const list = await fetchRecentSignals();
      setSignals(list);
    } catch {}
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleReview = async (id: string, review: 'GOOD' | 'BAD') => {
    try {
      const updated = await reviewSignal(id, review);
      setSignals(prev => prev.map(s => s._id === id ? updated : s));
    } catch {}
  };

  const dirColor: Record<string, string> = {
    BUY: '#26a69a',
    SELL: '#ef5350',
    EXIT_LONG: '#ff9800',
    EXIT_SHORT: '#ff9800',
    FLAT: '#8a8a9a',
  };

  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <h3 style={styles.title}>Signal Feed</h3>
        <button style={styles.refreshBtn} onClick={load}>Refresh</button>
      </div>

      {signals.length === 0 && <div style={styles.empty}>No signals yet. Enable a strategy and run Test.</div>}

      {signals.map(s => (
        <div key={s._id} style={styles.card}>
          <div style={styles.cardTop}>
            <span style={{ color: dirColor[s.direction] ?? '#d1d4dc', fontWeight: 'bold', fontSize: 13 }}>
              {s.direction}
            </span>
            <span style={styles.meta}>{s.instrument.replace('_', '/')} · {s.strategyName ?? s.source ?? ''}</span>
            <span style={styles.confidence}>{(s.confidence * 100).toFixed(0)}%</span>
          </div>

          {(s.triggeredConditions?.length ?? 0) > 0 && (
            <div style={styles.conditions}>
              {s.triggeredConditions!.map((c, i) => (
                <span key={i} style={styles.condTag}>{c}</span>
              ))}
            </div>
          )}

          <div style={styles.time}>{new Date(s.timestamp).toLocaleString()}</div>

          <div style={styles.reviewRow}>
            {s.review ? (
              <span style={{ color: s.review === 'GOOD' ? '#26a69a' : '#ef5350', fontSize: 12, fontWeight: 'bold' }}>
                {s.review}
              </span>
            ) : (
              <>
                <button style={styles.goodBtn} onClick={() => handleReview(s._id, 'GOOD')}>Good</button>
                <button style={styles.badBtn} onClick={() => handleReview(s._id, 'BAD')}>Bad</button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { background: '#16213e', borderRadius: 8, padding: 16, marginBottom: 12, maxHeight: 400, overflowY: 'auto' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { margin: 0, color: '#d1d4dc', fontSize: 16 },
  refreshBtn: { background: '#0f3460', color: '#d1d4dc', border: '1px solid #2a2a3e', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 11 },
  empty: { color: '#8a8a9a', fontSize: 13, textAlign: 'center', padding: 20 },
  card: { background: '#0d1b3e', borderRadius: 6, padding: 10, marginBottom: 8 },
  cardTop: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 },
  meta: { color: '#8a8a9a', fontSize: 11, flex: 1 },
  confidence: { color: '#ffeb3b', fontSize: 12, fontWeight: 'bold' },
  conditions: { display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 },
  condTag: { background: '#16213e', color: '#d1d4dc', fontSize: 10, padding: '2px 6px', borderRadius: 3, border: '1px solid #2a2a3e' },
  time: { color: '#555', fontSize: 10, marginBottom: 6 },
  reviewRow: { display: 'flex', gap: 6 },
  goodBtn: { background: 'transparent', color: '#26a69a', border: '1px solid #26a69a', borderRadius: 3, padding: '2px 10px', cursor: 'pointer', fontSize: 11 },
  badBtn: { background: 'transparent', color: '#ef5350', border: '1px solid #ef5350', borderRadius: 3, padding: '2px 10px', cursor: 'pointer', fontSize: 11 },
};
