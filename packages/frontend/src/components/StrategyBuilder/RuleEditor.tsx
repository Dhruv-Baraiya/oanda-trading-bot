import type { StrategyRule, StrategyCondition } from '../../services/api';
import { ConditionEditor } from './ConditionEditor';

interface Props {
  rule: StrategyRule;
  onChange: (rule: StrategyRule) => void;
}

export function RuleEditor({ rule, onChange }: Props) {
  const addCondition = () => {
    onChange({
      ...rule,
      conditions: [...rule.conditions, { indicator: 'rsi', field: 'value', op: 'lt', value: 30 }],
    });
  };

  const updateCondition = (index: number, cond: StrategyCondition) => {
    const updated = [...rule.conditions];
    updated[index] = cond;
    onChange({ ...rule, conditions: updated });
  };

  const removeCondition = (index: number) => {
    onChange({ ...rule, conditions: rule.conditions.filter((_, i) => i !== index) });
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.name}>{rule.name}</span>
        <select
          style={styles.logicSelect}
          value={rule.logic}
          onChange={e => onChange({ ...rule, logic: e.target.value as 'AND' | 'OR' })}
        >
          <option value="AND">ALL (AND)</option>
          <option value="OR">ANY (OR)</option>
        </select>
      </div>

      {rule.conditions.map((cond, i) => (
        <ConditionEditor
          key={i}
          condition={cond}
          onChange={c => updateCondition(i, c)}
          onRemove={() => removeCondition(i)}
        />
      ))}

      <button style={styles.addBtn} onClick={addCondition}>+ Add Condition</button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { marginBottom: 12, padding: 10, background: '#0d1b3e', borderRadius: 6 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  name: { color: '#d1d4dc', fontSize: 13, fontWeight: 'bold' },
  logicSelect: { background: '#0f3460', color: '#d1d4dc', border: '1px solid #2a2a3e', borderRadius: 3, padding: '3px 6px', fontSize: 11 },
  addBtn: { background: 'transparent', color: '#2196f3', border: '1px dashed #2196f3', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 11, marginTop: 4 },
};
