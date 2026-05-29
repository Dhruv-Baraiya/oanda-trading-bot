import type { BrokerAdapter } from './BrokerAdapter.js';
import type {
  AccountSummary,
  Candle,
  CloseResponse,
  GetCandlesParams,
  OrderRequest,
  OrderResponse,
  Position,
  PriceCallback,
  Trade,
} from './types.js';

interface OandaConfig {
  apiToken: string;
  accountId: string;
  baseUrl: string;
}

export class OandaAdapter implements BrokerAdapter {
  private config: OandaConfig;
  private headers: Record<string, string>;

  constructor(config: OandaConfig) {
    this.config = config;
    this.headers = {
      'Authorization': `Bearer ${config.apiToken}`,
      'Content-Type': 'application/json',
    };
  }

  private get accountUrl(): string {
    return `${this.config.baseUrl}/v3/accounts/${this.config.accountId}`;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.config.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: { ...this.headers, ...options.headers },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OANDA API ${res.status}: ${body}`);
    }

    return res.json() as Promise<T>;
  }

  // === Account ===

  async getInstruments(): Promise<import('./types.js').Instrument[]> {
    const data = await this.request<any>(`${this.accountUrl}/instruments`);
    return data.instruments.map((i: any) => ({
      name: i.name,
      displayName: i.displayName,
      type: i.type,
      pipLocation: i.pipLocation,
    }));
  }

  async getAccountSummary(): Promise<AccountSummary> {
    const data = await this.request<any>(`${this.accountUrl}/summary`);
    const a = data.account;
    return {
      id: a.id,
      balance: parseFloat(a.balance),
      unrealizedPL: parseFloat(a.unrealizedPL),
      nav: parseFloat(a.NAV),
      marginUsed: parseFloat(a.marginUsed),
      marginAvailable: parseFloat(a.marginAvailable),
      openTradeCount: a.openTradeCount,
      openPositionCount: a.openPositionCount,
      pendingOrderCount: a.pendingOrderCount,
      pl: parseFloat(a.pl),
    };
  }

  // === Market Data ===

  async getCandles(params: GetCandlesParams): Promise<Candle[]> {
    const qs = new URLSearchParams();
    qs.set('granularity', params.granularity);
    if (params.count) qs.set('count', String(params.count));
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    qs.set('price', 'BA');

    const data = await this.request<any>(
      `${this.config.baseUrl}/v3/instruments/${params.instrument}/candles?${qs}`
    );

    return data.candles
      .map((c: any) => ({
        timestamp: c.time,
        open: parseFloat(c.mid?.o ?? c.bid.o),
        high: parseFloat(c.mid?.h ?? c.bid.h),
        low: parseFloat(c.mid?.l ?? c.bid.l),
        close: parseFloat(c.mid?.c ?? c.bid.c),
        volume: c.volume,
        complete: c.complete,
      }));
  }

  private get streamUrl(): string {
    const base = this.config.baseUrl
      .replace('api-fxpractice', 'stream-fxpractice')
      .replace('api-fxtrade', 'stream-fxtrade');
    return `${base}/v3/accounts/${this.config.accountId}`;
  }

  streamPricing(instruments: string[], onPrice: PriceCallback): () => void {
    const controller = new AbortController();
    const url = `${this.streamUrl}/pricing/stream?instruments=${instruments.join('%2C')}`;

    const run = async () => {
      try {
        const res = await fetch(url, {
          headers: this.headers,
          signal: controller.signal,
        });

        if (!res.body) throw new Error('No response body for stream');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (msg.type === 'PRICE') {
                onPrice({
                  instrument: msg.instrument,
                  timestamp: msg.time,
                  bid: parseFloat(msg.bids[0].price),
                  ask: parseFloat(msg.asks[0].price),
                  spread: parseFloat(msg.asks[0].price) - parseFloat(msg.bids[0].price),
                });
              }
            } catch {}
          }
        }
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.error('Price stream error:', err.message);
        }
      }
    };

    run();
    return () => controller.abort();
  }

  // === Orders ===

  async placeOrder(order: OrderRequest): Promise<OrderResponse> {
    const body: any = {
      order: {
        type: order.type,
        instrument: order.instrument,
        units: String(order.units),
        timeInForce: order.timeInForce ?? (order.type === 'MARKET' ? 'FOK' : 'GTC'),
      },
    };

    if (order.price && order.type !== 'MARKET') {
      body.order.price = String(order.price);
    }
    if (order.priceBound) {
      body.order.priceBound = String(order.priceBound);
    }
    if (order.stopLossPrice) {
      body.order.stopLossOnFill = { price: String(order.stopLossPrice) };
    }
    if (order.takeProfitPrice) {
      body.order.takeProfitOnFill = { price: String(order.takeProfitPrice) };
    }
    if (order.trailingStopDistance) {
      body.order.trailingStopLossOnFill = { distance: String(order.trailingStopDistance) };
    }

    const data = await this.request<any>(`${this.accountUrl}/orders`, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    const fill = data.orderFillTransaction;
    const created = data.orderCreateTransaction;

    if (fill) {
      return {
        orderId: fill.orderID ?? fill.id,
        tradeId: fill.tradeOpened?.tradeID,
        instrument: fill.instrument,
        units: parseFloat(fill.units),
        price: parseFloat(fill.price),
        type: order.type,
        state: 'FILLED',
        timestamp: fill.time,
      };
    }

    return {
      orderId: created.id,
      instrument: created.instrument,
      units: parseFloat(created.units),
      price: parseFloat(created.price ?? '0'),
      type: created.type,
      state: 'PENDING',
      timestamp: created.time,
    };
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.request(`${this.accountUrl}/orders/${orderId}/cancel`, {
      method: 'PUT',
    });
  }

  async getPendingOrders(): Promise<OrderResponse[]> {
    const data = await this.request<any>(`${this.accountUrl}/pendingOrders`);
    return data.orders.map((o: any) => ({
      orderId: o.id,
      instrument: o.instrument,
      units: parseFloat(o.units),
      price: parseFloat(o.price ?? '0'),
      type: o.type,
      state: o.state,
      timestamp: o.createTime,
    }));
  }

  // === Trades ===

  async getOpenTrades(): Promise<Trade[]> {
    const data = await this.request<any>(`${this.accountUrl}/trades?state=OPEN`);
    return data.trades.map((t: any) => ({
      tradeId: t.id,
      instrument: t.instrument,
      units: parseFloat(t.currentUnits),
      price: parseFloat(t.price),
      openTime: t.openTime,
      state: t.state,
      unrealizedPL: parseFloat(t.unrealizedPL),
      stopLossPrice: t.stopLossOrder ? parseFloat(t.stopLossOrder.price) : undefined,
      takeProfitPrice: t.takeProfitOrder ? parseFloat(t.takeProfitOrder.price) : undefined,
    }));
  }

  async closeTrade(tradeId: string, units?: number): Promise<CloseResponse> {
    const body = units ? { units: String(units) } : { units: 'ALL' };
    const data = await this.request<any>(
      `${this.accountUrl}/trades/${tradeId}/close`,
      { method: 'PUT', body: JSON.stringify(body) }
    );

    const fill = data.orderFillTransaction;
    if (!fill) {
      const reason = data.orderCancelTransaction?.reason ?? 'Unknown';
      throw new Error(`Trade ${tradeId} close rejected: ${reason}`);
    }
    return {
      tradeId: fill.tradesClosed?.[0]?.tradeID ?? tradeId,
      instrument: fill.instrument,
      units: parseFloat(fill.units),
      price: parseFloat(fill.price),
      pl: parseFloat(fill.pl),
      timestamp: fill.time,
    };
  }

  async modifyTrade(tradeId: string, stopLoss?: number, takeProfit?: number): Promise<void> {
    const body: any = {};
    if (stopLoss !== undefined) body.stopLoss = { price: String(stopLoss) };
    if (takeProfit !== undefined) body.takeProfit = { price: String(takeProfit) };

    await this.request(`${this.accountUrl}/trades/${tradeId}/orders`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  // === Positions ===

  async getPositions(): Promise<Position[]> {
    const data = await this.request<any>(`${this.accountUrl}/openPositions`);
    return data.positions.map((p: any) => ({
      instrument: p.instrument,
      longUnits: parseFloat(p.long.units),
      shortUnits: parseFloat(p.short.units),
      unrealizedPL: parseFloat(p.unrealizedPL),
      pl: parseFloat(p.pl),
    }));
  }

  async closePosition(instrument: string, side: 'long' | 'short'): Promise<CloseResponse> {
    const body = side === 'long'
      ? { longUnits: 'ALL' }
      : { shortUnits: 'ALL' };

    const data = await this.request<any>(
      `${this.accountUrl}/positions/${instrument}/close`,
      { method: 'PUT', body: JSON.stringify(body) }
    );

    const fill = data.longOrderFillTransaction ?? data.shortOrderFillTransaction;
    return {
      tradeId: fill.id,
      instrument: fill.instrument,
      units: parseFloat(fill.units),
      price: parseFloat(fill.price),
      pl: parseFloat(fill.pl),
      timestamp: fill.time,
    };
  }

  // === Kill Switch (Section 3g workaround) ===

  async closeAllTrades(): Promise<CloseResponse[]> {
    const trades = await this.getOpenTrades();
    trades.sort((a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime());
    const results: CloseResponse[] = [];
    for (const trade of trades) {
      const result = await this.closeTrade(trade.tradeId);
      results.push(result);
    }
    return results;
  }

  async cancelAllOrders(): Promise<void> {
    const orders = await this.getPendingOrders();
    for (const order of orders) {
      await this.cancelOrder(order.orderId);
    }
  }
}
