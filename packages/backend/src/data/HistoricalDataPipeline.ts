import type { BrokerAdapter } from '../broker/BrokerAdapter.js';
import type { Candle, CandleGranularity } from '../broker/types.js';
import { D1CandleClient } from './D1Client.js';

const GRANULARITY_SECONDS: Record<string, number> = {
  M1: 60, M5: 300, M15: 900, M30: 1800,
  H1: 3600, H4: 14400, D: 86400, W: 604800,
};

const BATCH_SIZE = 5000;

export interface DownloadProgress {
  instrument: string;
  granularity: string;
  fetched: number;
  stored: number;
  from: string;
  to: string;
  done: boolean;
}

export type ProgressCallback = (progress: DownloadProgress) => void;

export class HistoricalDataPipeline {
  constructor(private broker: BrokerAdapter) {}

  async download(
    instrument: string,
    granularity: CandleGranularity,
    from: Date,
    to: Date,
    onProgress?: ProgressCallback
  ): Promise<{ fetched: number; stored: number }> {
    const secPerCandle = GRANULARITY_SECONDS[granularity] ?? 3600;
    let cursor = new Date(from);
    let totalFetched = 0;
    let totalStored = 0;

    while (cursor < to) {
      const batchEnd = new Date(Math.min(
        cursor.getTime() + BATCH_SIZE * secPerCandle * 1000,
        to.getTime()
      ));

      const candles = await this.broker.getCandles({
        instrument,
        granularity,
        from: cursor.toISOString(),
        to: batchEnd.toISOString(),
      });

      if (candles.length === 0) break;

      const completedCandles = candles.filter(c => c.complete);
      totalFetched += completedCandles.length;

      if (completedCandles.length > 0) {
        const stored = await this.storeCandles(instrument, granularity, completedCandles);
        totalStored += stored;
      }

      onProgress?.({
        instrument,
        granularity,
        fetched: totalFetched,
        stored: totalStored,
        from: from.toISOString(),
        to: to.toISOString(),
        done: false,
      });

      const lastTime = new Date(candles[candles.length - 1].timestamp);
      cursor = new Date(lastTime.getTime() + secPerCandle * 1000);

      await delay(50);
    }

    onProgress?.({
      instrument, granularity,
      fetched: totalFetched, stored: totalStored,
      from: from.toISOString(), to: to.toISOString(),
      done: true,
    });

    return { fetched: totalFetched, stored: totalStored };
  }

  private async storeCandles(
    instrument: string,
    granularity: string,
    candles: Candle[]
  ): Promise<number> {
    return D1CandleClient.upsert(instrument, granularity, candles);
  }

  async getStoredCandles(
    instrument: string,
    granularity: string,
    from: Date,
    to: Date
  ): Promise<Candle[]> {
    return D1CandleClient.find({ instrument, granularity, from, to });
  }

  async getStoredRange(instrument: string, granularity: string): Promise<{ from: Date; to: Date; count: number } | null> {
    return D1CandleClient.getRange(instrument, granularity);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
