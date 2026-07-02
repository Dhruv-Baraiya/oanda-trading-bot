import { io, type Socket } from 'socket.io-client';
import type { AccountSummary, Trade, OrderResponse } from './api';

export interface PriceUpdate {
  instrument: string;
  timestamp: string;
  bid: number;
  ask: number;
  spread: number;
}

let socket: Socket | null = null;

// Use the backend URL from env, stripping any /api suffix (socket.io connects at origin)
const rawUrl = import.meta.env.VITE_BACKEND_URL || '';
const BACKEND_URL = rawUrl
  ? rawUrl.replace(/\/api\/?$/, '')
  : window.location.origin;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(BACKEND_URL, {
      transports: ['websocket'],
    });
    socket.on('connect', () => console.log('Socket connected:', socket!.id));
    socket.on('connect_error', (err) => console.error('Socket error:', err.message));
  }
  return socket;
}

export function subscribePricing(instruments: string[]) {
  getSocket().emit('subscribe', instruments);
}

export function unsubscribePricing(instruments: string[]) {
  getSocket().emit('unsubscribe', instruments);
}

export function requestRefresh() {
  getSocket().emit('requestRefresh');
}

export function onPriceUpdate(callback: (price: PriceUpdate) => void) {
  const s = getSocket();
  s.on('price', callback);
  return () => { s.off('price', callback); };
}

export function onAccountUpdate(callback: (account: AccountSummary) => void) {
  const s = getSocket();
  s.on('account', callback);
  return () => { s.off('account', callback); };
}

export function onTradesUpdate(callback: (trades: Trade[]) => void) {
  const s = getSocket();
  s.on('trades', callback);
  return () => { s.off('trades', callback); };
}

export function onOrdersUpdate(callback: (orders: OrderResponse[]) => void) {
  const s = getSocket();
  s.on('orders', callback);
  return () => { s.off('orders', callback); };
}

export interface RiskState {
  dailyPnL: number;
  weeklyPnL: number;
  peakBalance: number;
  currentDrawdown: number;
  currentDrawdownPercent: number;
  openTradeCount: number;
  lastTickTime: number;
  streamHealthy: boolean;
  circuitBreakerTripped: boolean;
  tripReason: string | null;
  limits: {
    maxRiskPerTrade: number;
    maxDailyLoss: number;
    maxWeeklyLoss: number;
    maxDrawdown: number;
    maxOpenTrades: number;
    maxSpreadPips: number;
    staleSignalSeconds: number;
    staleTickSeconds: number;
  };
}

export interface StreamHealthStatus {
  state: 'CONNECTED' | 'STALE' | 'RECONNECTING' | 'DISCONNECTED';
  lastTickTime: number;
  lastTickAge: number;
  reconnectCount: number;
  entriesPaused: boolean;
  instruments: string[];
}

export function onRiskStateUpdate(callback: (state: RiskState) => void) {
  const s = getSocket();
  s.on('riskState', callback);
  return () => { s.off('riskState', callback); };
}

export function onStreamHealthUpdate(callback: (status: StreamHealthStatus) => void) {
  const s = getSocket();
  s.on('streamHealth', callback);
  return () => { s.off('streamHealth', callback); };
}

export function onRiskAlert(callback: (alert: { type: string; [key: string]: any }) => void) {
  const s = getSocket();
  s.on('riskAlert', callback);
  return () => { s.off('riskAlert', callback); };
}

export function resetCircuitBreaker() {
  getSocket().emit('resetCircuitBreaker');
}

export function onAutoTraderStatus(callback: (status: import('./api').AutoTraderStatus) => void) {
  const s = getSocket();
  s.on('autoTraderStatus', callback);
  return () => { s.off('autoTraderStatus', callback); };
}

export function onDecision(callback: (decision: import('./api').DecisionLog) => void) {
  const s = getSocket();
  s.on('decision', callback);
  return () => { s.off('decision', callback); };
}
