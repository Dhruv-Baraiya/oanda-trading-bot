import type { BrokerAdapter } from '../broker/BrokerAdapter.js';
import type { CandleGranularity } from '../broker/types.js';
import { CandleModel } from './models.js';

export async function fetchAndStoreCandles(
  broker: BrokerAdapter,
  instrument: string,
  granularity: CandleGranularity,
  count: number = 500
): Promise<number> {
  const candles = await broker.getCandles({ instrument, granularity, count });

  let inserted = 0;
  for (const c of candles) {
    try {
      await CandleModel.updateOne(
        { instrument, granularity, timestamp: new Date(c.timestamp) },
        {
          $set: {
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          },
        },
        { upsert: true }
      );
      inserted++;
    } catch {}
  }

  console.log(`Stored ${inserted}/${candles.length} ${granularity} candles for ${instrument}`);
  return inserted;
}

export async function fetchHistoricalRange(
  broker: BrokerAdapter,
  instrument: string,
  granularity: CandleGranularity,
  from: string,
  to: string
): Promise<number> {
  let totalInserted = 0;
  let currentFrom = from;

  while (currentFrom < to) {
    const candles = await broker.getCandles({
      instrument,
      granularity,
      from: currentFrom,
      count: 5000,
    });

    if (candles.length === 0) break;

    for (const c of candles) {
      try {
        await CandleModel.updateOne(
          { instrument, granularity, timestamp: new Date(c.timestamp) },
          {
            $set: {
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
              volume: c.volume,
            },
          },
          { upsert: true }
        );
        totalInserted++;
      } catch {}
    }

    const lastTimestamp = candles[candles.length - 1].timestamp;
    if (lastTimestamp <= currentFrom) break;
    currentFrom = lastTimestamp;

    console.log(`Fetched up to ${currentFrom} — ${totalInserted} candles total`);
  }

  return totalInserted;
}
