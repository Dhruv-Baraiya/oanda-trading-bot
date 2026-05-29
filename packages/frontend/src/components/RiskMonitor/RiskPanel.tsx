import { useState, useEffect } from 'react';
import {
  onRiskStateUpdate,
  onStreamHealthUpdate,
  onRiskAlert,
  resetCircuitBreaker,
  type RiskState,
  type StreamHealthStatus,
} from '../../services/socket';

const STREAM_COLORS: Record<string, string> = {
  CONNECTED: '#26a69a',
  STALE: '#ff9800',
  RECONNECTING: '#ffeb3b',
  DISCONNECTED: '#ef5350',
};

export function RiskPanel() {
  const [risk, setRisk] = useState<RiskState | null>(null);
  const [stream, setStream] = useState<StreamHealthStatus | null>(null);
  const [alerts, setAlerts] = useState<string[]>([]);

  useEffect(() => {
    const unsub1 = onRiskStateUpdate(setRisk);
    const unsub2 = onStreamHealthUpdate(setStream);
    const unsub3 = onRiskAlert((alert) => {
      setAlerts(prev => [`[${alert.type}] ${JSON.stringify(alert)}`, ...prev].slice(0, 5));
    });
    return () => { unsub1(); unsub2(); unsub3(); };
  }, []);

  if (!risk) return <div style={styles.container}>Loading risk state...</div>;

  const dailyUsed = risk.limits.maxDailyLoss > 0
    ? Math.abs(Math.min(0, risk.dailyPnL)) / (risk.peakBalance * risk.limits.maxDailyLoss) * 100
    : 0;
  const weeklyUsed = risk.limits.maxWeeklyLoss > 0
    ? Math.abs(Math.min(0, risk.weeklyPnL)) / (risk.peakBalance * risk.limits.maxWeeklyLoss) * 100
    : 0;
  const ddUsed = risk.limits.maxDrawdown > 0
    ? (risk.currentDrawdownPercent / risk.limits.maxDrawdown) * 100
    : 0;

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>Risk Monitor</h3>

      {/* Stream Health */}
      <div style={styles.streamRow}>
        <span style={styles.label}>Stream</span>
        <span style={{
          ...styles.streamBadge,
          background: STREAM_COLORS[stream?.state ?? 'DISCONNECTED'] + '22',
          color: STREAM_COLORS[stream?.state ?? 'DISCONNECTED'],
          borderColor: STREAM_COLORS[stream?.state ?? 'DISCONNECTED'],
        }}>
          {stream?.state ?? 'UNKNOWN'}
        </span>
        {stream?.reconnectCount ? (
          <span style={styles.reconnectCount}>({stream.reconnectCount} reconnects)</span>
        ) : null}
      </div>

      {/* Circuit Breaker */}
      {risk.circuitBreakerTripped && (
        <div style={styles.alert}>
          <span style={styles.alertText}>CIRCUIT BREAKER: {risk.tripReason}</span>
          <button style={styles.resetBtn} onClick={resetCircuitBreaker}>Reset</button>
        </div>
      )}

      {/* Daily P&L */}
      <div style={styles.limitRow}>
        <span style={styles.label}>Daily P&L</span>
        <span style={{ color: risk.dailyPnL >= 0 ? '#26a69a' : '#ef5350', fontSize: 12, fontWeight: 'bold' }}>
          {risk.dailyPnL >= 0 ? '+' : ''}${risk.dailyPnL.toFixed(2)}
        </span>
      </div>
      <ProgressBar percent={Math.min(dailyUsed, 100)} label={`${dailyUsed.toFixed(0)}% of ${(risk.limits.maxDailyLoss * 100)}% limit`} />

      {/* Weekly P&L */}
      <div style={styles.limitRow}>
        <span style={styles.label}>Weekly P&L</span>
        <span style={{ color: risk.weeklyPnL >= 0 ? '#26a69a' : '#ef5350', fontSize: 12, fontWeight: 'bold' }}>
          {risk.weeklyPnL >= 0 ? '+' : ''}${risk.weeklyPnL.toFixed(2)}
        </span>
      </div>
      <ProgressBar percent={Math.min(weeklyUsed, 100)} label={`${weeklyUsed.toFixed(0)}% of ${(risk.limits.maxWeeklyLoss * 100)}% limit`} />

      {/* Drawdown */}
      <div style={styles.limitRow}>
        <span style={styles.label}>Drawdown</span>
        <span style={{ color: '#ef5350', fontSize: 12, fontWeight: 'bold' }}>
          {(risk.currentDrawdownPercent * 100).toFixed(2)}%
        </span>
      </div>
      <ProgressBar percent={Math.min(ddUsed, 100)} label={`${ddUsed.toFixed(0)}% of ${(risk.limits.maxDrawdown * 100)}% breaker`} danger />

      {/* Stats row */}
      <div style={styles.statsRow}>
        <div style={styles.statItem}>
          <span style={styles.statLabel}>Peak</span>
          <span style={styles.statValue}>${risk.peakBalance.toFixed(2)}</span>
        </div>
        <div style={styles.statItem}>
          <span style={styles.statLabel}>Open</span>
          <span style={styles.statValue}>{risk.openTradeCount}/{risk.limits.maxOpenTrades}</span>
        </div>
        <div style={styles.statItem}>
          <span style={styles.statLabel}>Risk/Trade</span>
          <span style={styles.statValue}>{(risk.limits.maxRiskPerTrade * 100).toFixed(1)}%</span>
        </div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div style={styles.alertList}>
          {alerts.map((a, i) => (
            <div key={i} style={styles.alertItem}>{a}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProgressBar({ percent, label, danger }: { percent: number; label: string; danger?: boolean }) {
  const color = danger
    ? (percent > 75 ? '#ef5350' : percent > 50 ? '#ff9800' : '#26a69a')
    : (percent > 75 ? '#ff9800' : '#2196f3');

  return (
    <div style={styles.barContainer}>
      <div style={{ ...styles.barFill, width: `${Math.min(percent, 100)}%`, background: color }} />
      <span style={styles.barLabel}>{label}</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { background: '#16213e', borderRadius: 8, padding: 16, marginBottom: 12 },
  title: { margin: '0 0 12px', color: '#d1d4dc', fontSize: 16 },
  streamRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 },
  streamBadge: {
    fontSize: 10, fontWeight: 'bold', padding: '2px 8px', borderRadius: 4,
    border: '1px solid', textTransform: 'uppercase',
  },
  reconnectCount: { color: '#8a8a9a', fontSize: 10 },
  label: { color: '#8a8a9a', fontSize: 11 },
  alert: {
    background: '#ef535022', border: '1px solid #ef5350', borderRadius: 6,
    padding: '8px 10px', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  alertText: { color: '#ef5350', fontSize: 11, fontWeight: 'bold', flex: 1 },
  resetBtn: {
    background: '#ef5350', color: '#fff', border: 'none', borderRadius: 4,
    padding: '4px 10px', cursor: 'pointer', fontSize: 11, fontWeight: 'bold',
  },
  limitRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, marginBottom: 4 },
  barContainer: {
    position: 'relative', height: 16, background: '#0d1b3e', borderRadius: 4,
    overflow: 'hidden', marginBottom: 6,
  },
  barFill: { position: 'absolute', top: 0, left: 0, height: '100%', borderRadius: 4, transition: 'width 0.3s' },
  barLabel: { position: 'absolute', top: 0, left: 6, lineHeight: '16px', fontSize: 10, color: '#d1d4dc', zIndex: 1 },
  statsRow: { display: 'flex', justifyContent: 'space-between', marginTop: 10, paddingTop: 8, borderTop: '1px solid #2a2a3e' },
  statItem: { textAlign: 'center' },
  statLabel: { display: 'block', color: '#8a8a9a', fontSize: 10, marginBottom: 2 },
  statValue: { color: '#d1d4dc', fontSize: 13, fontWeight: 'bold' },
  alertList: { marginTop: 8, borderTop: '1px solid #2a2a3e', paddingTop: 8 },
  alertItem: { color: '#ff9800', fontSize: 10, padding: '2px 0', borderBottom: '1px solid #16213e' },
};
