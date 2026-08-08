import { useState, useEffect } from 'react';
import { CandlestickChart } from './components/Chart/CandlestickChart';
import { RSIChart } from './components/Chart/RSIChart';
import { MACDChart } from './components/Chart/MACDChart';
import { PriceTicker } from './components/Chart/PriceTicker';
import { ManualTrade } from './components/Chart/ManualTrade';
import { TradeList } from './components/Chart/TradeList';
import { AccountPanel } from './components/RiskMonitor/AccountPanel';
import { RiskPanel } from './components/RiskMonitor/RiskPanel';
import { KillSwitch } from './components/KillSwitch/KillSwitch';
import { StrategyBuilder } from './components/StrategyBuilder/StrategyBuilder';
import { SignalFeed } from './components/SignalFeed/SignalFeed';
import { BacktestPanel } from './components/Backtest/BacktestPanel';
import { AutoTraderPanel } from './components/AutoTrader/AutoTraderPanel';
import { TradeHistoryPanel } from './components/TradeHistory/TradeHistoryPanel';
import { useCandles } from './hooks/useCandles';
import { useAccount } from './hooks/useAccount';
import { useTrades } from './hooks/useTrades';
import { fetchInstruments, type Instrument } from './services/api';

const GRANULARITIES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D'];

type SidebarTab = 'trading' | 'history' | 'strategies' | 'signals' | 'backtest' | 'bot';

function App() {
  const [instruments, setInstruments] = useState<Instrument[]>([]);
  const [instrument, setInstrument] = useState('EUR_USD');
  const [granularity, setGranularity] = useState('H1');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('trading');
  const { candles, indicators, loading, error, refresh } = useCandles(instrument, granularity, 300);
  const { account, error: accountError, refresh: refreshAccount } = useAccount();
  const { trades, refresh: refreshTrades } = useTrades();

  useEffect(() => {
    fetchInstruments()
      .then(list => {
        const forex = list.filter(i => i.type === 'CURRENCY');
        setInstruments(forex);
      })
      .catch(() => {
        setInstruments([
          { name: 'EUR_USD', displayName: 'EUR/USD', type: 'CURRENCY', pipLocation: -4 },
          { name: 'GBP_USD', displayName: 'GBP/USD', type: 'CURRENCY', pipLocation: -4 },
          { name: 'USD_JPY', displayName: 'USD/JPY', type: 'CURRENCY', pipLocation: -2 },
        ]);
      });
  }, []);

  const handleAction = () => {
    refreshTrades();
    refreshAccount();
  };

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <h1 style={styles.h1}>OANDA Trading Bot</h1>
        <div style={styles.controls}>
          <select style={styles.select} value={instrument} onChange={e => setInstrument(e.target.value)}>
            {instruments.map(i => <option key={i.name} value={i.name}>{i.displayName}</option>)}
          </select>
          <select style={styles.select} value={granularity} onChange={e => setGranularity(e.target.value)}>
            {GRANULARITIES.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <button style={styles.refreshBtn} onClick={refresh}>Refresh</button>
        </div>
      </header>

      <div style={styles.layout}>
        <div style={styles.chartCol}>
          <PriceTicker instrument={instrument} />
          {error && <div style={styles.error}>{error}</div>}
          {loading && candles.length === 0 && <div style={styles.loading}>Loading chart...</div>}
          <CandlestickChart candles={candles} indicators={indicators} instrument={instrument} height={450} />
          <RSIChart indicators={indicators} height={130} />
          <MACDChart indicators={indicators} height={130} />
        </div>

        <div style={styles.sidebar}>
          <div style={styles.tabs}>
            {(['trading', 'history', 'strategies', 'signals', 'backtest', 'bot'] as SidebarTab[]).map(tab => (
              <button
                key={tab}
                style={{ ...styles.tab, ...(sidebarTab === tab ? styles.tabActive : {}) }}
                onClick={() => setSidebarTab(tab)}
              >
                {{ trading: 'Trade', history: 'History', strategies: 'Strategy', signals: 'Signals', backtest: 'Backtest', bot: 'Bot' }[tab]}
              </button>
            ))}
          </div>

          {sidebarTab === 'trading' && (
            <>
              <AccountPanel account={account} error={accountError} />
              <RiskPanel />
              <KillSwitch onActivated={handleAction} />
              <ManualTrade instrument={instrument} onOrderPlaced={handleAction} />
              <TradeList trades={trades} onTradeAction={handleAction} />
            </>
          )}

          {sidebarTab === 'history' && (
            <TradeHistoryPanel />
          )}

          {sidebarTab === 'strategies' && (
            <StrategyBuilder instruments={instruments} />
          )}

          {sidebarTab === 'signals' && (
            <SignalFeed />
          )}

          {sidebarTab === 'backtest' && (
            <BacktestPanel />
          )}

          {sidebarTab === 'bot' && (
            <AutoTraderPanel />
          )}
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  app: {
    background: '#0a0a1a', minHeight: '100vh', color: '#d1d4dc',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '12px 20px', borderBottom: '1px solid #2a2a3e',
  },
  h1: { margin: 0, fontSize: 20, color: '#fff' },
  controls: { display: 'flex', gap: 8 },
  select: {
    background: '#16213e', color: '#d1d4dc', border: '1px solid #2a2a3e',
    borderRadius: 4, padding: '6px 12px', fontSize: 13,
  },
  refreshBtn: {
    background: '#0f3460', color: '#d1d4dc', border: '1px solid #2a2a3e',
    borderRadius: 4, padding: '6px 16px', cursor: 'pointer', fontSize: 13,
  },
  layout: { display: 'flex', gap: 16, padding: 16 },
  chartCol: { flex: 1, minWidth: 0 },
  sidebar: { width: 360, flexShrink: 0 },
  tabs: { display: 'flex', gap: 4, marginBottom: 12 },
  tab: {
    flex: 1, padding: '8px 0', textAlign: 'center', fontSize: 13, fontWeight: 'bold',
    background: '#16213e', color: '#8a8a9a', border: '1px solid #2a2a3e',
    borderRadius: 6, cursor: 'pointer',
  },
  tabActive: { background: '#0f3460', color: '#fff', borderColor: '#2196f3' },
  error: { color: '#ef5350', padding: 12, background: '#1a1a2e', borderRadius: 8, marginBottom: 12 },
  loading: { color: '#8a8a9a', padding: 20, textAlign: 'center' },
};

export default App;
