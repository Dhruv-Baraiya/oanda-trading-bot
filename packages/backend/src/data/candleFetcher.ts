import type { BrokerAdapter } from '../broker/BrokerAdapter.js';
import type { CandleGranularity } from '../broker/types.js';
import { D1CandleClient } from './D1Client.js';

export async function fetchAndStoreCandles(
  broker: BrokerAdapter,
  instrument: string,
  granularity: CandleGranularity,
  count: number = 500
): Promise<number> {
  const candles = await broker.getCandles({ instrument, granularity, count });

  const inserted = await D1CandleClient.upsert(instrument, granularity, candles);
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

    const batchInserted = await D1CandleClient.upsert(instrument, granularity, candles);
    totalInserted += batchInserted;

    const lastTimestamp = candles[candles.length - 1].timestamp;
    if (lastTimestamp <= currentFrom) break;
    currentFrom = lastTimestamp;

    console.log(`Fetched up to ${currentFrom} — ${totalInserted} candles total`);
  }

  return totalInserted;
}
