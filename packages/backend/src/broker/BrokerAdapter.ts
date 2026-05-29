import type {
  AccountSummary,
  Candle,
  CloseResponse,
  GetCandlesParams,
  Instrument,
  OrderRequest,
  OrderResponse,
  Position,
  PriceCallback,
  Trade,
} from './types.js';

export interface BrokerAdapter {
  // Account
  getAccountSummary(): Promise<AccountSummary>;
  getInstruments(): Promise<Instrument[]>;

  // Market Data
  getCandles(params: GetCandlesParams): Promise<Candle[]>;
  streamPricing(instruments: string[], onPrice: PriceCallback): () => void;

  // Orders
  placeOrder(order: OrderRequest): Promise<OrderResponse>;
  cancelOrder(orderId: string): Promise<void>;
  getPendingOrders(): Promise<OrderResponse[]>;

  // Trades
  getOpenTrades(): Promise<Trade[]>;
  closeTrade(tradeId: string, units?: number): Promise<CloseResponse>;
  modifyTrade(tradeId: string, stopLoss?: number, takeProfit?: number): Promise<void>;

  // Positions
  getPositions(): Promise<Position[]>;
  closePosition(instrument: string, side: 'long' | 'short'): Promise<CloseResponse>;

  // Kill Switch (loop workaround for missing bulk close)
  closeAllTrades(): Promise<CloseResponse[]>;
  cancelAllOrders(): Promise<void>;
}
