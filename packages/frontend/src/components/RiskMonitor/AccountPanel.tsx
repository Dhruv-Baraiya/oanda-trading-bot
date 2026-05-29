import type { AccountSummary } from '../../services/api';

interface Props {
  account: AccountSummary | null;
  error: string | null;
}

export function AccountPanel({ account, error }: Props) {
  if (error) return <div style={styles.error}>Account error: {error}</div>;
  if (!account) return <div style={styles.container}>Loading account...</div>;

  const plColor = account.pl >= 0 ? '#26a69a' : '#ef5350';
  const uplColor = account.unrealizedPL >= 0 ? '#26a69a' : '#ef5350';

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>Account</h3>
      <div style={styles.grid}>
        <Stat label="Balance" value={`$${account.balance.toFixed(2)}`} />
        <Stat label="NAV" value={`$${account.nav.toFixed(2)}`} />
        <Stat label="P&L" value={`$${account.pl.toFixed(4)}`} color={plColor} />
        <Stat label="Unrealized" value={`$${account.unrealizedPL.toFixed(4)}`} color={uplColor} />
        <Stat label="Margin Used" value={`$${account.marginUsed.toFixed(2)}`} />
        <Stat label="Open Trades" value={String(account.openTradeCount)} />
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={styles.stat}>
      <div style={styles.label}>{label}</div>
      <div style={{ ...styles.value, color: color ?? '#d1d4dc' }}>{value}</div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { background: '#16213e', borderRadius: 8, padding: 16, marginBottom: 12 },
  title: { margin: '0 0 12px', color: '#d1d4dc', fontSize: 16 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 },
  stat: { textAlign: 'center' },
  label: { color: '#8a8a9a', fontSize: 11, marginBottom: 4 },
  value: { color: '#d1d4dc', fontSize: 14, fontWeight: 'bold' },
  error: { color: '#ef5350', padding: 16 },
};
