import { useState, useEffect } from 'react';
import {
  fetchStrategies,
  createStrategy,
  updateStrategy,
  deleteStrategy,
  toggleStrategy,
  evaluateStrategy,
  type Strategy,
  type Instrument,
} from '../../services/api';
import { RuleEditor } from './RuleEditor';

const GRANULARITIES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D'];

const EMPTY_STRATEGY: Omit<Strategy, '_id'> = {
  name: 'New Strategy',
  instrument: 'EUR_USD',
  granularity: 'H1',
  enabled: false,
  entryLong: { name: 'Long Entry', logic: 'AND', conditions: [{ indicator: 'rsi', field: 'value', op: 'lt', value: 30 }] },
  entryShort: { name: 'Short Entry', logic: 'AND', conditions: [{ indicator: 'rsi', field: 'value', op: 'gt', value: 70 }] },
  exitLong: { name: 'Long Exit', logic: 'OR', conditions: [{ indicator: 'rsi', field: 'value', op: 'gt', value: 70 }] },
  exitShort: { name: 'Short Exit', logic: 'OR', conditions: [{ indicator: 'rsi', field: 'value', op: 'lt', value: 30 }] },
  riskPerTrade: 0.005,
  stopLossATRMultiplier: 1.5,
  takeProfitRatio: 2.0,
  maxOpenTrades: 3,
};

interface Props {
  instruments: Instrument[];
}

export function StrategyBuilder({ instruments }: Props) {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [editing, setEditing] = useState<Strategy | null>(null);
  const [evalResult, setEvalResult] = useState<string | null>(null);

  const load = async () => {
    try {
      const list = await fetchStrategies();
      setStrategies(list);
    } catch {}
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    try {
      const created = await createStrategy(EMPTY_STRATEGY);
      setStrategies(prev => [created, ...prev]);
      setEditing(created);
    } catch (err: any) {
      alert('Failed to create: ' + err.message);
    }
  };

  const handleSave = async () => {
    if (!editing) return;
    try {
      const { _id, ...rest } = editing;
      const updated = await updateStrategy(_id, rest);
      setStrategies(prev => prev.map(s => s._id === _id ? updated : s));
      setEditing(null);
    } catch (err: any) {
      alert('Failed to save: ' + err.message);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteStrategy(id);
      setStrategies(prev => prev.filter(s => s._id !== id));
      if (editing?._id === id) setEditing(null);
    } catch {}
  };

  const handleToggle = async (id: string) => {
    try {
      const result = await toggleStrategy(id);
      setStrategies(prev => prev.map(s => s._id === id ? { ...s, enabled: result.enabled } : s));
    } catch {}
  };

  const handleEvaluate = async (id: string) => {
    try {
      const { signal } = await evaluateStrategy(id);
      setEvalResult(signal ? `${signal.direction} (${(signal.confidence * 100).toFixed(0)}%)` : 'No signal');
      setTimeout(() => setEvalResult(null), 5000);
    } catch (err: any) {
      setEvalResult('Error: ' + err.message);
    }
  };

  if (editing) {
    return (
      <div style={styles.container}>
        <div style={styles.headerRow}>
          <h3 style={styles.title}>Edit Strategy</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <button style={styles.saveBtn} onClick={handleSave}>Save</button>
            <button style={styles.cancelBtn} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>

        <label style={styles.label}>Name</label>
        <input style={styles.input} value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} />

        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>Instrument</label>
            <select style={styles.selectFull} value={editing.instrument} onChange={e => setEditing({ ...editing, instrument: e.target.value })}>
              {instruments.map(i => <option key={i.name} value={i.name}>{i.displayName}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={styles.label}>Timeframe</label>
            <select style={styles.selectFull} value={editing.granularity} onChange={e => setEditing({ ...editing, granularity: e.target.value })}>
              {GRANULARITIES.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <div>
            <label style={styles.label}>Risk/Trade</label>
            <input style={styles.inputSmall} type="number" step="0.001" value={editing.riskPerTrade}
              onChange={e => setEditing({ ...editing, riskPerTrade: parseFloat(e.target.value) || 0 })} />
          </div>
          <div>
            <label style={styles.label}>SL ATR x</label>
            <input style={styles.inputSmall} type="number" step="0.1" value={editing.stopLossATRMultiplier}
              onChange={e => setEditing({ ...editing, stopLossATRMultiplier: parseFloat(e.target.value) || 1.5 })} />
          </div>
          <div>
            <label style={styles.label}>TP Ratio</label>
            <input style={styles.inputSmall} type="number" step="0.1" value={editing.takeProfitRatio}
              onChange={e => setEditing({ ...editing, takeProfitRatio: parseFloat(e.target.value) || 2.0 })} />
          </div>
          <div>
            <label style={styles.label}>Max Trades</label>
            <input style={styles.inputSmall} type="number" step="1" value={editing.maxOpenTrades}
              onChange={e => setEditing({ ...editing, maxOpenTrades: parseInt(e.target.value) || 3 })} />
          </div>
        </div>

        <RuleEditor rule={editing.entryLong} onChange={r => setEditing({ ...editing, entryLong: r })} />
        <RuleEditor rule={editing.entryShort} onChange={r => setEditing({ ...editing, entryShort: r })} />
        <RuleEditor rule={editing.exitLong} onChange={r => setEditing({ ...editing, exitLong: r })} />
        <RuleEditor rule={editing.exitShort} onChange={r => setEditing({ ...editing, exitShort: r })} />
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <h3 style={styles.title}>Strategies ({strategies.length})</h3>
        <button style={styles.createBtn} onClick={handleCreate}>+ New</button>
      </div>

      {evalResult && <div style={styles.evalResult}>{evalResult}</div>}

      {strategies.length === 0 && <div style={styles.empty}>No strategies yet. Create one to start.</div>}

      {strategies.map(s => (
        <div key={s._id} style={styles.card}>
          <div style={styles.cardHeader}>
            <span style={{ ...styles.cardName, color: s.enabled ? '#26a69a' : '#8a8a9a' }}>{s.name}</span>
            <span style={styles.cardMeta}>{s.instrument.replace('_', '/')} {s.granularity}</span>
          </div>
          <div style={styles.cardActions}>
            <button style={styles.actionBtn} onClick={() => handleToggle(s._id)}>
              {s.enabled ? 'Disable' : 'Enable'}
            </button>
            <button style={styles.actionBtn} onClick={() => setEditing(s)}>Edit</button>
            <button style={styles.actionBtn} onClick={() => handleEvaluate(s._id)}>Test</button>
            <button style={{ ...styles.actionBtn, color: '#ef5350' }} onClick={() => handleDelete(s._id)}>Del</button>
          </div>
        </div>
      ))}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { background: '#16213e', borderRadius: 8, padding: 16, marginBottom: 12, maxHeight: 600, overflowY: 'auto' },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { margin: 0, color: '#d1d4dc', fontSize: 16 },
  createBtn: { background: '#26a69a', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 14px', cursor: 'pointer', fontSize: 12, fontWeight: 'bold' },
  saveBtn: { background: '#26a69a', color: '#fff', border: 'none', borderRadius: 4, padding: '5px 12px', cursor: 'pointer', fontSize: 12 },
  cancelBtn: { background: '#555', color: '#fff', border: 'none', borderRadius: 4, padding: '5px 12px', cursor: 'pointer', fontSize: 12 },
  label: { color: '#8a8a9a', fontSize: 11, display: 'block', marginBottom: 3 },
  input: { width: '100%', background: '#0f3460', color: '#d1d4dc', border: '1px solid #2a2a3e', borderRadius: 4, padding: '6px 10px', fontSize: 13, marginBottom: 8 },
  inputSmall: { width: 70, background: '#0f3460', color: '#d1d4dc', border: '1px solid #2a2a3e', borderRadius: 4, padding: '5px 6px', fontSize: 12 },
  selectFull: { width: '100%', background: '#0f3460', color: '#d1d4dc', border: '1px solid #2a2a3e', borderRadius: 4, padding: '6px 8px', fontSize: 13 },
  empty: { color: '#8a8a9a', fontSize: 13, textAlign: 'center', padding: 20 },
  card: { background: '#0d1b3e', borderRadius: 6, padding: 10, marginBottom: 8 },
  cardHeader: { display: 'flex', justifyContent: 'space-between', marginBottom: 6 },
  cardName: { fontSize: 13, fontWeight: 'bold' },
  cardMeta: { color: '#8a8a9a', fontSize: 11 },
  cardActions: { display: 'flex', gap: 6 },
  actionBtn: { background: 'transparent', color: '#2196f3', border: '1px solid #2a2a3e', borderRadius: 3, padding: '3px 8px', cursor: 'pointer', fontSize: 11 },
  evalResult: { color: '#ffeb3b', fontSize: 12, padding: 8, textAlign: 'center', marginBottom: 8 },
};
