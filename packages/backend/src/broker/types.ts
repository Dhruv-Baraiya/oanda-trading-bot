export interface Candle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  complete: boolean;
}

export interface PriceUpdate {
  instrument: string;
  timestamp: string;
  bid: number;
  ask: number;
  spread: number;
}

export interface OrderRequest {
  instrument: string;
  units: number; // positive = buy, negative = sell
  type: 'MARKET' | 'LIMIT' | 'STOP' | 'MARKET_IF_TOUCHED';
  price?: number;
  timeInForce?: 'FOK' | 'IOC' | 'GTC' | 'GTD' | 'DAY';
  stopLossPrice?: number;
  takeProfitPrice?: number;
  trailingStopDistance?: number;
  priceBound?: number;
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

export interface Position {
  instrument: string;
  longUnits: number;
  shortUnits: number;
  unrealizedPL: number;
  pl: number;
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

export interface CloseResponse {
  tradeId: string;
  instrument: string;
  units: number;
  price: number;
  pl: number;
  timestamp: string;
}

export interface Instrument {
  name: string;
  displayName: string;
  type: string;
  pipLocation: number;
}

export type CandleGranularity =
  | 'S5' | 'S10' | 'S15' | 'S30'
  | 'M1' | 'M2' | 'M4' | 'M5' | 'M10' | 'M15' | 'M30'
  | 'H1' | 'H2' | 'H3' | 'H4' | 'H6' | 'H8' | 'H12'
  | 'D' | 'W' | 'M';

export interface GetCandlesParams {
  instrument: string;
  granularity: CandleGranularity;
  count?: number;
  from?: string;
  to?: string;
}

export interface ClosedTrade {
  tradeId: string;
  instrument: string;
  units: number;
  entryPrice: number;
  exitPrice: number;
  openTime: string;
  closeTime: string;
  pl: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
}

export type PriceCallback = (price: PriceUpdate) => void;
