import { useState, useEffect } from 'react';
import {
  fetchAutoTraderStatus,
  startAutoTrader,
  stopAutoTrader,
  fetchDecisionLogs,
  clearDecisionLogs,
  fetchMLStatus,
  type AutoTraderStatus,
  type DecisionLog,
  type MLStatus,
} from '../../services/api';
import { onAutoTraderStatus, onDecision } from '../../services/socket';

const TYPE_COLORS: Record<string, string> = {
  SIGNAL_GENERATED: '#2196f3',
  RISK_CHECK_PASSED: '#26a69a',
  RISK_CHECK_FAILED: '#ff9800',
  ORDER_PLACED: '#26a69a',
  ORDER_REJECTED: '#ef5350',
  TRADE_OPENED: '#26a69a',
  TRADE_CLOSED: '#ffeb3b',
  EXIT_SIGNAL: '#ff9800',
  EVALUATION_SKIP: '#8a8a9a',
  BOT_STARTED: '#2196f3',
  BOT_STOPPED: '#8a8a9a',
};

export function AutoTraderPanel() {
  const [status, setStatus] = useState<AutoTraderStatus | null>(null);
  const [decisions, setDecisions] = useState<DecisionLog[]>([]);
  const [mlStatus, setMlStatus] = useState<MLStatus | null>(null);
  const [interval, setInterval_] = useState(60);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchAutoTraderStatus().then(setStatus).catch(() => {});
    fetchDecisionLogs({ limit: 30 }).then(setDecisions).catch(() => {});
    fetchMLStatus().then(setMlStatus).catch(() => {});

    const mlPoll = window.setInterval(() => {
      fetchMLStatus().then(setMlStatus).catch(() => {});
    }, 10000);

    const unsub1 = onAutoTraderStatus(setStatus);
    const unsub2 = onDecision((d) => {
      setDecisions(prev => [d, ...prev].slice(0, 50));
    });
    return () => { unsub1(); unsub2(); window.clearInterval(mlPoll); };
  }, []);

  const handleStart = async () => {
    setLoading(true);
    try {
      const { status: s } = await startAutoTrader(interval * 1000);
      setStatus(s);
    } catch {}
    setLoading(false);
  };

  const handleStop = async () => {
    setLoading(true);
    try {
      const { status: s } = await stopAutoTrader();
      setStatus(s);
    } catch {}
    setLoading(false);
  };

  const handleClear = async () => {
    await clearDecisionLogs();
    setDecisions([]);
  };

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>Auto-Trader</h3>

      {/* Control Panel */}
      <div style={styles.controlRow}>
        <div style={{
          ...styles.statusBadge,
          background: status?.running ? '#26a69a22' : '#ef535022',
          color: status?.running ? '#26a69a' : '#ef5350',
          borderColor: status?.running ? '#26a69a' : '#ef5350',
        }}>
          {status?.running ? 'RUNNING' : 'STOPPED'}
        </div>
        {!status?.running ? (
          <>
            <input
              style={styles.intervalInput}
              type="number"
              min={10}
              value={interval}
              onChange={e => setInterval_(parseInt(e.target.value) || 60)}
              title="Interval (seconds)"
            />
            <span style={styles.secLabel}>sec</span>
            <button style={styles.startBtn} onClick={handleStart} disabled={loading}>
              {loading ? '...' : 'Start'}
            </button>
          </>
        ) : (
          <button style={styles.stopBtn} onClick={handleStop} disabled={loading}>
            {loading ? '...' : 'Stop'}
          </button>
        )}
      </div>

      {/* Stats */}
      {status && (
        <div style={styles.statsGrid}>
          <div style={styles.stat}>
            <span style={styles.statLabel}>Evaluations</span>
            <span style={styles.statValue}>{status.evaluationCount}</span>
          </div>
          <div style={styles.stat}>
            <span style={styles.statLabel}>Trades</span>
            <span style={styles.statValue}>{status.tradesPlaced}</span>
          </div>
          <div style={styles.stat}>
            <span style={styles.statLabel}>Rejected</span>
            <span style={styles.statValue}>{status.tradesRejected}</span>
          </div>
          <div style={styles.stat}>
            <span style={styles.statLabel}>Errors</span>
            <span style={styles.statValue}>{status.errors}</span>
          </div>
          {status.lastEvaluation && (
            <div style={{ ...styles.stat, gridColumn: '1 / -1' }}>
              <span style={styles.statLabel}>Last Eval</span>
              <span style={styles.statValue}>{new Date(status.lastEvaluation).toLocaleTimeString()}</span>
            </div>
          )}
        </div>
      )}

      {/* ML Status */}
      <div style={{ ...styles.mlSection, borderTop: '1px solid #2a2a3e', paddingTop: 10, marginBottom: 12 }}>
        <h4 style={{ margin: '0 0 8px', color: '#d1d4dc', fontSize: 13 }}>AI/ML Engine</h4>
        {!mlStatus ? (
          <div style={{ color: '#8a8a9a', fontSize: 11 }}>Loading...</div>
        ) : !mlStatus.online ? (
          <div style={{ color: '#ef5350', fontSize: 11 }}>ML Service Offline</div>
        ) : (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <span style={{
                fontSize: 10, fontWeight: 'bold', padding: '2px 8px', borderRadius: 3,
                background: mlStatus.model_loaded ? '#26a69a22' : '#ff980022',
                color: mlStatus.model_loaded ? '#26a69a' : '#ff9800',
              }}>
                {mlStatus.model_loaded ? 'MODEL LOADED' : 'NO MODEL'}
              </span>
              <span style={{
                fontSize: 10, fontWeight: 'bold', padding: '2px 8px', borderRadius: 3,
                background: '#2196f322', color: '#2196f3',
              }}>
                {mlStatus.training?.state?.toUpperCase() || 'IDLE'}
              </span>
            </div>
            {mlStatus.training && mlStatus.training.state !== 'idle' && (
              <div style={{ background: '#0d1b3e', borderRadius: 4, padding: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: '#d1d4dc', fontSize: 11 }}>{mlStatus.training.message}</span>
                  <span style={{ color: '#2196f3', fontSize: 11, fontWeight: 'bold' }}>{mlStatus.training.progress}%</span>
                </div>
                <div style={{ background: '#1a1a2e', borderRadius: 2, height: 6, overflow: 'hidden' }}>
                  <div style={{
                    background: mlStatus.training.state === 'complete' ? '#26a69a' :
                      mlStatus.training.state === 'error' ? '#ef5350' : '#2196f3',
                    height: '100%', width: `${mlStatus.training.progress}%`,
                    transition: 'width 0.5s ease',
                  }} />
                </div>
                {mlStatus.training.state === 'complete' && mlStatus.training.metrics && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginTop: 8 }}>
                    {mlStatus.training.metrics.val_direction_accuracy != null && (
                      <div style={styles.stat}>
                        <span style={styles.statLabel}>Val Accuracy</span>
                        <span style={styles.statValue}>{(mlStatus.training.metrics.val_direction_accuracy * 100).toFixed(1)}%</span>
                      </div>
                    )}
                    {mlStatus.training.metrics.val_loss != null && (
                      <div style={styles.stat}>
                        <span style={styles.statLabel}>Val Loss</span>
                        <span style={styles.statValue}>{mlStatus.training.metrics.val_loss.toFixed(4)}</span>
                      </div>
                    )}
                    {mlStatus.training.metrics.epochs_run != null && (
                      <div style={styles.stat}>
                        <span style={styles.statLabel}>Epochs</span>
                        <span style={styles.statValue}>{mlStatus.training.metrics.epochs_run}</span>
                      </div>
                    )}
                  </div>
                )}
                {mlStatus.training.state === 'error' && (
                  <div style={{ color: '#ef5350', fontSize: 10, marginTop: 4 }}>{mlStatus.training.message}</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Decision Log */}
      <div style={styles.logHeader}>
        <h4 style={styles.logTitle}>Decision Log ({decisions.length})</h4>
        <button style={styles.clearBtn} onClick={handleClear}>Clear</button>
      </div>

      <div style={styles.logList}>
        {decisions.length === 0 && (
          <div style={styles.empty}>No decisions yet. Start auto-trader with enabled strategies.</div>
        )}
        {decisions.map((d, i) => (
          <div key={d._id ?? i} style={styles.logEntry}>
            <div style={styles.logTop}>
              <span style={{
                fontSize: 9, fontWeight: 'bold', padding: '1px 5px', borderRadius: 3,
                background: (TYPE_COLORS[d.type] ?? '#8a8a9a') + '22',
                color: TYPE_COLORS[d.type] ?? '#8a8a9a',
              }}>
                {d.type.replace(/_/g, ' ')}
              </span>
              <span style={styles.logTime}>{new Date(d.timestamp).toLocaleTimeString()}</span>
            </div>
            {d.strategyName && (
              <div style={styles.logDetail}>
                {d.strategyName} · {d.instrument?.replace('_', '/')}
                {d.direction ? ` · ${d.direction}` : ''}
                {d.confidence ? ` (${(d.confidence * 100).toFixed(0)}%)` : ''}
              </div>
            )}
            {d.riskCheckResult && !d.riskCheckResult.allowed && (
              <div style={{ color: '#ff9800', fontSize: 10 }}>Reason: {d.riskCheckResult.reason}</div>
            )}
            {d.orderDetails?.price && (
              <div style={{ color: '#26a69a', fontSize: 10 }}>
                Order: {d.orderDetails.units} @ {d.orderDetails.price} | SL: {d.orderDetails.stopLoss} | TP: {d.orderDetails.takeProfit}
              </div>
            )}
            {d.tradeResult?.pnl !== undefined && (
              <div style={{ color: d.tradeResult.pnl >= 0 ? '#26a69a' : '#ef5350', fontSize: 10 }}>
                P&L: ${d.tradeResult.pnl?.toFixed(4)} ({d.tradeResult.exitReason})
              </div>
            )}
            {d.message && <div style={{ color: '#8a8a9a', fontSize: 10 }}>{d.message}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { background: '#16213e', borderRadius: 8, padding: 16, marginBottom: 12, maxHeight: 700, overflowY: 'auto' },
  title: { margin: '0 0 12px', color: '#d1d4dc', fontSize: 16 },
  controlRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 },
  statusBadge: {
    fontSize: 11, fontWeight: 'bold', padding: '4px 10px', borderRadius: 4,
    border: '1px solid', textTransform: 'uppercase',
  },
  intervalInput: {
    width: 50, background: '#0f3460', color: '#d1d4dc', border: '1px solid #2a2a3e',
    borderRadius: 4, padding: '4px 6px', fontSize: 12, textAlign: 'center',
  },
  secLabel: { color: '#8a8a9a', fontSize: 11 },
  startBtn: {
    background: '#26a69a', color: '#fff', border: 'none', borderRadius: 4,
    padding: '6px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 'bold', marginLeft: 'auto',
  },
  stopBtn: {
    background: '#ef5350', color: '#fff', border: 'none', borderRadius: 4,
    padding: '6px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 'bold', marginLeft: 'auto',
  },
  statsGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 12 },
  stat: { textAlign: 'center', background: '#0d1b3e', borderRadius: 4, padding: '6px 4px' },
  statLabel: { display: 'block', color: '#8a8a9a', fontSize: 9, marginBottom: 2 },
  statValue: { color: '#d1d4dc', fontSize: 14, fontWeight: 'bold' },
  logHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, borderTop: '1px solid #2a2a3e', paddingTop: 10 },
  logTitle: { margin: 0, color: '#d1d4dc', fontSize: 13 },
  clearBtn: { background: 'transparent', color: '#ef5350', border: '1px solid #2a2a3e', borderRadius: 3, padding: '2px 8px', cursor: 'pointer', fontSize: 10 },
  logList: { maxHeight: 350, overflowY: 'auto' },
  empty: { color: '#8a8a9a', fontSize: 12, textAlign: 'center', padding: 16 },
  logEntry: { background: '#0d1b3e', borderRadius: 4, padding: 8, marginBottom: 4 },
  logTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 },
  logTime: { color: '#555', fontSize: 10 },
  logDetail: { color: '#d1d4dc', fontSize: 11 },
  mlSection: {},
};
