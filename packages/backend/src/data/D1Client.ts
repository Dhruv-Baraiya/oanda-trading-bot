import type { Candle } from '../broker/types.js';

const D1_WORKER_URL = process.env.D1_WORKER_URL || 'http://localhost:8787';
const D1_API_KEY = process.env.D1_API_KEY || 'CHANGE_ME_TO_A_SECURE_KEY';

const headers = {
  'Content-Type': 'application/json',
  'X-API-Key': D1_API_KEY,
};

async function d1Fetch(path: string, options?: RequestInit): Promise<any> {
  const res = await fetch(`${D1_WORKER_URL}${path}`, { ...options, headers: { ...headers, ...options?.headers } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`D1 Worker error ${res.status}: ${body}`);
  }
  return res.json();
}

export const D1CandleClient = {
  async find(params: {
    instrument: string;
    granularity: string;
    from?: Date;
    to?: Date;
    limit?: number;
    offset?: number;
  }): Promise<Candle[]> {
    const qs = new URLSearchParams({
      instrument: params.instrument,
      granularity: params.granularity,
    });
    if (params.from) qs.set('from', params.from.toISOString());
    if (params.to) qs.set('to', params.to.toISOString());
    if (params.limit) qs.set('limit', params.limit.toString());
    if (params.offset) qs.set('offset', params.offset.toString());

    const data = await d1Fetch(`/candles?${qs}`);
    return data.candles.map((c: any) => ({
      timestamp: c.timestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      complete: true,
    }));
  },

  async upsert(
    instrument: string,
    granularity: string,
    candles: Candle[]
  ): Promise<number> {
    const payload = candles.map(c => ({
      instrument,
      granularity,
      timestamp: c.timestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));

    // Send in chunks of 500 (Worker handles internal D1 batching)
    let totalInserted = 0;
    for (let i = 0; i < payload.length; i += 500) {
      const chunk = payload.slice(i, i + 500);
      const data = await d1Fetch('/candles', {
        method: 'POST',
        body: JSON.stringify({ candles: chunk }),
      });
      totalInserted += data.inserted;
    }
    return totalInserted;
  },

  async upsertOne(
    instrument: string,
    granularity: string,
    candle: Candle
  ): Promise<void> {
    await this.upsert(instrument, granularity, [candle]);
  },

  async getRange(
    instrument: string,
    granularity: string
  ): Promise<{ from: Date; to: Date; count: number } | null> {
    const data = await d1Fetch(
      `/candles/range?instrument=${instrument}&granularity=${granularity}`
    );
    if (!data) return null;
    return { from: new Date(data.from), to: new Date(data.to), count: data.count };
  },

  async count(
    instrument?: string,
    granularity?: string
  ): Promise<{ instrument: string; granularity: string; count: number }[]> {
    const qs = new URLSearchParams();
    if (instrument) qs.set('instrument', instrument);
    if (granularity) qs.set('granularity', granularity);
    return d1Fetch(`/candles/count?${qs}`);
  },

  async delete(instrument: string, granularity: string): Promise<number> {
    const data = await d1Fetch(
      `/candles?instrument=${instrument}&granularity=${granularity}`,
      { method: 'DELETE' }
    );
    return data.deleted;
  },
};
