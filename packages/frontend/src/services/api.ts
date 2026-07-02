import axios from 'axios';

const rawUrl = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/+$/, '');
const baseURL = rawUrl ? `${rawUrl.replace(/\/api\/?$/, '')}/api` : '/api';

const api = axios.create({
  baseURL,
  timeout: 15000,
});

export interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorSnapshot {
  timestamp: string;
  close: number;
  rsi: { value: number; overbought: boolean; oversold: boolean } | null;
  macd: { macd: number; signal: number; histogram: number; bullish: boolean } | null;
  bollingerBands: { upper: number; middle: number; lower: number; bandwidth: number; percentB: number } | null;
  atr: { value: number } | null;
  ema: { short: number; mid: number; long: number; shortAboveMid: boolean; shortAboveLong: boolean; midAboveLong: boolean } | null;
}

export interface AccountSummary {
  id: string;
  balance: number;
  unrealizedPL: number;
  nav: number;
  marginUsed: number;
  marginAvailable: number;
  openTradeCount: number;
  openPositionCount: number;
  pendingOrderCount: number;
  pl: number;
}

export interface Trade {
  tradeId: string;
  instrument: string;
  units: number;
  price: number;
  openTime: string;
  state: string;
  unrealizedPL: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
}

export interface OrderResponse {
  orderId: string;
  tradeId?: string;
  instrument: string;
  units: number;
  price: number;
  type: string;
  state: string;
  timestamp: string;
}

export async function fetchCandles(instrument: string, granularity = 'H1', count = 300) {
  const { data } = await api.get(`/candles/${instrument}?granularity=${granularity}&count=${count}`);
  return data.candles as Candle[];
}

export async function fetchIndicators(instrument: string, granularity = 'H1', count = 300) {
  const { data } = await api.get(`/candles/${instrument}/indicators?granularity=${granularity}&count=${count}`);
  return data.indicators as IndicatorSnapshot[];
}

export interface Instrument {
  name: string;
  displayName: string;
  type: string;
  pipLocation: number;
}

export async function fetchInstruments() {
  const { data } = await api.get('/instruments');
  return data.instruments as Instrument[];
}

export async function fetchAccountSummary() {
  const { data } = await api.get('/account/summary');
  return data as AccountSummary;
}

export async function fetchOpenTrades() {
  const { data } = await api.get('/trades');
  return data.trades as Trade[];
}

export async function placeOrder(order: {
  instrument: string;
  units: number;
  type: string;
  stopLossPrice?: number;
  takeProfitPrice?: number;
}) {
  const { data } = await api.post('/orders', order);
  return data as OrderResponse;
}

export async function closeTrade(tradeId: string) {
  const { data } = await api.post(`/trades/close/${tradeId}`);
  return data;
}

export async function activateKillSwitch() {
  const { data } = await api.post('/killswitch/activate');
  return data;
}

export async function fetchPendingOrders() {
  const { data } = await api.get('/orders/pending');
  return data.orders as OrderResponse[];
}

// === Strategies ===

export interface StrategyCondition {
  indicator: string;
  field: string;
  op: string;
  value: number | string;
}

export interface StrategyRule {
  name: string;
  conditions: StrategyCondition[];
  logic: 'AND' | 'OR';
}

export interface Strategy {
  _id: string;
  name: string;
  instrument: string;
  granularity: string;
  enabled: boolean;
  entryLong: StrategyRule;
  entryShort: StrategyRule;
  exitLong: StrategyRule;
  exitShort: StrategyRule;
  riskPerTrade: number;
  stopLossATRMultiplier: number;
  takeProfitRatio: number;
  maxOpenTrades: number;
}

export interface SignalRecord {
  _id: string;
  strategyId?: string;
  strategyName?: string;
  source?: string;
  instrument: string;
  direction: string;
  confidence: number;
  triggeredConditions?: string[];
  indicators?: Record<string, number>;
  timestamp: string;
  acted: boolean;
  review?: 'GOOD' | 'BAD';
  reviewNotes?: string;
}

export async function fetchStrategies() {
  const { data } = await api.get('/strategies');
  return data.strategies as Strategy[];
}

export async function createStrategy(strategy: Omit<Strategy, '_id'>) {
  const { data } = await api.post('/strategies', strategy);
  return data as Strategy;
}

export async function updateStrategy(id: string, updates: Partial<Strategy>) {
  const { data } = await api.put(`/strategies/${id}`, updates);
  return data as Strategy;
}

export async function deleteStrategy(id: string) {
  await api.delete(`/strategies/${id}`);
}

export async function toggleStrategy(id: string) {
  const { data } = await api.post(`/strategies/${id}/toggle`);
  return data as { enabled: boolean };
}

export async function evaluateStrategy(id: string) {
  const { data } = await api.post(`/strategies/${id}/evaluate`);
  return data as { signal: SignalRecord | null };
}

export async function fetchRecentSignals() {
  const { data } = await api.get('/strategies/signals/recent');
  return data.signals as SignalRecord[];
}

export async function reviewSignal(signalId: string, review: 'GOOD' | 'BAD', reviewNotes?: string) {
  const { data } = await api.post(`/strategies/signals/${signalId}/review`, { review, reviewNotes });
  return data as SignalRecord;
}

// === Backtest ===

export interface BacktestTrade {
  id: number;
  direction: 'LONG' | 'SHORT';
  entryTime: string;
  entryPrice: number;
  exitTime: string;
  exitPrice: number;
  units: number;
  stopLoss: number;
  takeProfit: number;
  pnl: number;
  pnlPercent: number;
  exitReason: string;
}

export interface EquityPoint {
  timestamp: string;
  equity: number;
  drawdown: number;
}

export interface BacktestMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  netProfit: number;
  netProfitPercent: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  avgWin: number;
  avgLoss: number;
  avgRiskReward: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
}

export interface BacktestResult {
  _id: string;
  strategyId: string;
  strategyName: string;
  instrument: string;
  granularity: string;
  metrics: BacktestMetrics;
  trades: BacktestTrade[];
  equityCurve: EquityPoint[];
  startBalance: number;
  endBalance: number;
  runAt: string;
}

export interface BacktestSummary {
  _id: string;
  strategyId: string;
  strategyName: string;
  instrument: string;
  granularity: string;
  from: string;
  to: string;
  initialBalance: number;
  endBalance: number;
  metrics: BacktestMetrics;
  runAt: string;
}

export async function runBacktest(params: {
  strategyId: string;
  from: string;
  to: string;
  initialBalance?: number;
  spreadPips?: number;
  slippagePips?: number;
}) {
  const { data } = await api.post('/backtest/run', params, { timeout: 120000 });
  return data as BacktestResult;
}

export async function fetchBacktestResults() {
  const { data } = await api.get('/backtest/results');
  return data.results as BacktestSummary[];
}

export async function fetchBacktestResult(id: string) {
  const { data } = await api.get(`/backtest/results/${id}`);
  return data as BacktestResult;
}

export async function deleteBacktestResult(id: string) {
  await api.delete(`/backtest/results/${id}`);
}

// === Auto-Trader ===

export interface AutoTraderStatus {
  running: boolean;
  lastEvaluation: string | null;
  evaluationCount: number;
  activeStrategies: number;
  tradesPlaced: number;
  tradesRejected: number;
  errors: number;
  startedAt: string | null;
}

export interface DecisionLog {
  _id: string;
  timestamp: string;
  type: string;
  strategyId?: string;
  strategyName?: string;
  instrument?: string;
  direction?: string;
  confidence?: number;
  riskCheckResult?: { allowed: boolean; reason: string | null };
  orderDetails?: Record<string, any>;
  tradeResult?: Record<string, any>;
  triggeredConditions?: string[];
  message?: string;
}

export async function fetchAutoTraderStatus() {
  const { data } = await api.get('/autotrader/status');
  return data as AutoTraderStatus;
}

export async function startAutoTrader(intervalMs = 60000) {
  const { data } = await api.post('/autotrader/start', { intervalMs });
  return data as { started: boolean; status: AutoTraderStatus };
}

export async function stopAutoTrader() {
  const { data } = await api.post('/autotrader/stop');
  return data as { stopped: boolean; status: AutoTraderStatus };
}

export async function fetchDecisionLogs(params?: { limit?: number; type?: string; instrument?: string }) {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.type) qs.set('type', params.type);
  if (params?.instrument) qs.set('instrument', params.instrument);
  const { data } = await api.get(`/autotrader/decisions?${qs}`);
  return data.decisions as DecisionLog[];
}

export async function clearDecisionLogs() {
  const { data } = await api.delete('/autotrader/decisions');
  return data as { deleted: number };
}
