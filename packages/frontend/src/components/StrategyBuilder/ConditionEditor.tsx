import type { StrategyCondition } from '../../services/api';

const INDICATORS = [
  { value: 'rsi', label: 'RSI', fields: ['value'] },
  { value: 'macd', label: 'MACD', fields: ['macd', 'signal', 'histogram'] },
  { value: 'bollingerBands', label: 'Bollinger Bands', fields: ['upper', 'middle', 'lower', 'percentB'] },
  { value: 'atr', label: 'ATR', fields: ['value'] },
  { value: 'ema', label: 'EMA', fields: ['short', 'mid', 'long'] },
];

const OPS = [
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'crosses_above', label: 'Crosses Above' },
  { value: 'crosses_below', label: 'Crosses Below' },
];

const REFERENCE_VALUES = [
  { value: '', label: 'Number...' },
  { value: 'ema.short', label: 'EMA Short (20)' },
  { value: 'ema.mid', label: 'EMA Mid (50)' },
  { value: 'ema.long', label: 'EMA Long (200)' },
  { value: 'bollingerBands.upper', label: 'BB Upper' },
  { value: 'bollingerBands.middle', label: 'BB Middle' },
  { value: 'bollingerBands.lower', label: 'BB Lower' },
];

interface Props {
  condition: StrategyCondition;
  onChange: (cond: StrategyCondition) => void;
  onRemove: () => void;
}

export function ConditionEditor({ condition, onChange, onRemove }: Props) {
  const selectedIndicator = INDICATORS.find(i => i.value === condition.indicator);
  const fields = selectedIndicator?.fields ?? [];

  return (
    <div style={styles.row}>
      <select
        style={styles.select}
        value={condition.indicator}
        onChange={e => {
          const ind = INDICATORS.find(i => i.value === e.target.value);
          onChange({ ...condition, indicator: e.target.value, field: ind?.fields[0] ?? '' });
        }}
      >
        {INDICATORS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
      </select>

      <select
        style={styles.selectSmall}
        value={condition.field}
        onChange={e => onChange({ ...condition, field: e.target.value })}
      >
        {fields.map(f => <option key={f} value={f}>{f}</option>)}
      </select>

      <select
        style={styles.selectSmall}
        value={condition.op}
        onChange={e => onChange({ ...condition, op: e.target.value })}
      >
        {OPS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>

      <select
        style={styles.selectSmall}
        value={typeof condition.value === 'string' ? condition.value : ''}
        onChange={e => {
          if (e.target.value) {
            onChange({ ...condition, value: e.target.value });
          }
        }}
      >
        {REFERENCE_VALUES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
      </select>

      {typeof condition.value === 'number' || (typeof condition.value === 'string' && !condition.value.includes('.')) ? (
        <input
          style={styles.input}
          type="number"
          step="any"
          value={typeof condition.value === 'number' ? condition.value : ''}
          onChange={e => onChange({ ...condition, value: parseFloat(e.target.value) || 0 })}
          placeholder="value"
        />
      ) : null}

      <button style={styles.removeBtn} onClick={onRemove}>x</button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  row: { display: 'flex', gap: 4, alignItems: 'center', marginBottom: 6 },
  select: { background: '#0f3460', color: '#d1d4dc', border: '1px solid #2a2a3e', borderRadius: 3, padding: '4px 6px', fontSize: 12 },
  selectSmall: { background: '#0f3460', color: '#d1d4dc', border: '1px solid #2a2a3e', borderRadius: 3, padding: '4px 4px', fontSize: 11, maxWidth: 90 },
  input: { background: '#0f3460', color: '#d1d4dc', border: '1px solid #2a2a3e', borderRadius: 3, padding: '4px 6px', fontSize: 12, width: 60 },
  removeBtn: { background: '#ef5350', color: '#fff', border: 'none', borderRadius: 3, padding: '3px 7px', cursor: 'pointer', fontSize: 11 },
};
