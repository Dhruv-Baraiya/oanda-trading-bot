import type { OandaAdapter } from '../broker/OandaAdapter.js';
import type { CandleGranularity } from '../broker/types.js';
import { SentimentModel } from './models.js';
import { D1CandleClient } from './D1Client.js';

interface CollectorConfig {
  instruments: string[];
  granularities: CandleGranularity[];
  sentimentInstruments: string[];
}

const DEFAULT_CONFIG: CollectorConfig = {
  instruments: ['EUR_USD'],
  granularities: ['M1', 'M15', 'H1', 'H4'],
  sentimentInstruments: ['EUR_USD'],
};

const CANDLE_COUNTS: Record<string, number> = {
  M1: 60,
  M15: 16,
  H1: 6,
  H4: 6,
};

export class DataCollector {
  private broker: OandaAdapter;
  private config: CollectorConfig;
  private timers: ReturnType<typeof setInterval>[] = [];
  private running = false;
  private stats = { candlesSaved: 0, sentimentSaved: 0, errors: 0, lastRun: null as string | null };

  constructor(broker: OandaAdapter, config?: Partial<CollectorConfig>) {
    this.broker = broker;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    await this.collectAll();

    // H1 candles + sentiment: every hour
    this.timers.push(setInterval(() => this.collectAll(), 60 * 60 * 1000));

    // M1 candles: every 5 minutes
    this.timers.push(setInterval(() => this.collectCandles(['M1']), 5 * 60 * 1000));

    // M15 candles: every 15 minutes
    this.timers.push(setInterval(() => this.collectCandles(['M15']), 15 * 60 * 1000));

    console.log('[DataCollector] Started — instruments:', this.config.instruments.join(', '));
  }

  stop(): void {
    this.running = false;
    this.timers.forEach(t => clearInterval(t));
    this.timers = [];
    console.log('[DataCollector] Stopped');
  }

  getStats() {
    return { ...this.stats, running: this.running };
  }

  private async collectAll(): Promise<void> {
    await this.collectCandles(this.config.granularities as string[]);
    await this.collectSentiment();
    this.stats.lastRun = new Date().toISOString();
  }

  private async collectCandles(granularities: string[]): Promise<void> {
    for (const instrument of this.config.instruments) {
      for (const gran of granularities) {
        try {
          const count = CANDLE_COUNTS[gran] || 6;
          const candles = await this.broker.getCandles({
            instrument,
            granularity: gran as CandleGranularity,
            count,
          });

          const completedCandles = candles.filter(c => c.complete);

          const inserted = await D1CandleClient.upsert(instrument, gran, completedCandles);
          this.stats.candlesSaved += inserted;
        } catch (err: any) {
          this.stats.errors++;
          console.error(`[DataCollector] Candle fetch error ${instrument}/${gran}:`, err.message);
        }
      }
    }
  }

  private async collectSentiment(): Promise<void> {
    for (const instrument of this.config.sentimentInstruments) {
      try {
        const orderBook = await this.broker.getOrderBook(instrument);
        const totalLong = orderBook.buckets.reduce((s, b) => s + parseFloat(b.longCountPercent), 0);
        const totalShort = orderBook.buckets.reduce((s, b) => s + parseFloat(b.shortCountPercent), 0);

        await SentimentModel.updateOne(
          { instrument, source: 'orderBook', timestamp: new Date(orderBook.timestamp) },
          {
            $set: {
              longRatio: totalLong / (totalLong + totalShort || 1),
              shortRatio: totalShort / (totalLong + totalShort || 1),
              longCount: Math.round(totalLong * 100),
              shortCount: Math.round(totalShort * 100),
            },
          },
          { upsert: true }
        );
        this.stats.sentimentSaved++;
      } catch (err: any) {
        this.stats.errors++;
        console.error(`[DataCollector] OrderBook error ${instrument}:`, err.message);
      }

      try {
        const posBook = await this.broker.getPositionBook(instrument);
        const totalLong = posBook.buckets.reduce((s, b) => s + parseFloat(b.longCountPercent), 0);
        const totalShort = posBook.buckets.reduce((s, b) => s + parseFloat(b.shortCountPercent), 0);

        await SentimentModel.updateOne(
          { instrument, source: 'positionBook', timestamp: new Date(posBook.timestamp) },
          {
            $set: {
              longRatio: totalLong / (totalLong + totalShort || 1),
              shortRatio: totalShort / (totalLong + totalShort || 1),
              longCount: Math.round(totalLong * 100),
              shortCount: Math.round(totalShort * 100),
            },
          },
          { upsert: true }
        );
        this.stats.sentimentSaved++;
      } catch (err: any) {
        this.stats.errors++;
        console.error(`[DataCollector] PositionBook error ${instrument}:`, err.message);
      }
    }
  }

  async backfillCandles(instrument: string, granularity: CandleGranularity, count: number): Promise<number> {
    const candles = await this.broker.getCandles({ instrument, granularity, count });
    const completed = candles.filter(c => c.complete);
    return D1CandleClient.upsert(instrument, granularity, completed);
  }

  async backfillDateRange(
    instrument: string,
    granularity: CandleGranularity,
    from: string,
    to: string,
    onProgress?: (saved: number, batch: number) => void,
  ): Promise<number> {
    let saved = 0;
    let batch = 0;
    let cursor = from;

    while (cursor < to) {
      const candles = await this.broker.getCandles({
        instrument,
        granularity,
        count: 5000,
        from: cursor,
      });

      if (candles.length === 0) break;

      const completed = candles.filter(c => c.complete && c.timestamp <= to);
      const batchSaved = await D1CandleClient.upsert(instrument, granularity, completed);
      saved += batchSaved;

      batch++;
      if (onProgress) onProgress(saved, batch);

      // Move cursor past last candle
      const lastTimestamp = candles[candles.length - 1].timestamp;
      if (lastTimestamp <= cursor) break;
      cursor = lastTimestamp;

      // Rate limit: 100ms between requests
      await new Promise(r => setTimeout(r, 100));
    }

    return saved;
  }
}
