import type { BacktestMetrics } from '../../services/api';

interface Props {
  metrics: BacktestMetrics;
  startBalance: number;
  endBalance: number;
}

export function MetricsPanel({ metrics, startBalance, endBalance }: Props) {
  const m = metrics ?? {} as BacktestMetrics;
  const n = (v: number | null | undefined) => v ?? 0;

  const rows: [string, string, string?][] = [
    ['Net P&L', `$${n(m.netProfit).toFixed(2)}`, n(m.netProfit) >= 0 ? '#26a69a' : '#ef5350'],
    ['Return', `${(n(m.netProfitPercent) * 100).toFixed(2)}%`, n(m.netProfitPercent) >= 0 ? '#26a69a' : '#ef5350'],
    ['Total Trades', String(n(m.totalTrades))],
    ['Win Rate', `${(n(m.winRate) * 100).toFixed(1)}%`],
    ['Profit Factor', m.profitFactor === Infinity ? '∞' : n(m.profitFactor).toFixed(2)],
    ['Sharpe Ratio', n(m.sharpeRatio).toFixed(2)],
    ['Max Drawdown', `${(n(m.maxDrawdownPercent) * 100).toFixed(2)}%`, '#ef5350'],
    ['Avg Win', `$${n(m.avgWin).toFixed(2)}`],
    ['Avg Loss', `$${n(m.avgLoss).toFixed(2)}`],
    ['Risk/Reward', n(m.avgRiskReward).toFixed(2)],
    ['Max Consec. Wins', String(n(m.maxConsecutiveWins))],
    ['Max Consec. Losses', String(n(m.maxConsecutiveLosses))],
    ['Start Balance', `$${(startBalance ?? 0).toFixed(2)}`],
    ['End Balance', `$${(endBalance ?? 0).toFixed(2)}`, (endBalance ?? 0) >= (startBalance ?? 0) ? '#26a69a' : '#ef5350'],
  ];

  return (
    <div style={styles.container}>
      <h4 style={styles.title}>Performance Metrics</h4>
      <div style={styles.grid}>
        {rows.map(([label, value, color]) => (
          <div key={label} style={styles.cell}>
            <span style={styles.label}>{label}</span>
            <span style={{ ...styles.value, color: color ?? '#d1d4dc' }}>{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { background: '#0d1b3e', borderRadius: 6, padding: 12, marginBottom: 12 },
  title: { margin: '0 0 10px', color: '#d1d4dc', fontSize: 14 },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 },
  cell: { display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: '#16213e', borderRadius: 4 },
  label: { color: '#8a8a9a', fontSize: 11 },
  value: { fontSize: 12, fontWeight: 'bold' },
};
