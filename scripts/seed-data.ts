import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../.env') });

import { OandaAdapter } from '../packages/backend/src/broker/OandaAdapter.js';
import { connectDB, disconnectDB } from '../packages/backend/src/data/db.js';
import { fetchHistoricalRange } from '../packages/backend/src/data/candleFetcher.js';

async function main() {
  const token = process.env.OANDA_API_TOKEN;
  const accountId = process.env.OANDA_ACCOUNT_ID;
  const baseUrl = process.env.OANDA_BASE_URL ?? 'https://api-fxpractice.oanda.com';

  if (!token || !accountId) {
    console.error('Missing OANDA_API_TOKEN or OANDA_ACCOUNT_ID in .env');
    process.exit(1);
  }

  await connectDB();

  const broker = new OandaAdapter({ apiToken: token, accountId, baseUrl });

  const pairs = ['EUR_USD'];
  const granularities = ['H1', 'D'] as const;

  for (const pair of pairs) {
    for (const gran of granularities) {
      console.log(`\nFetching ${pair} ${gran} from 2019...`);
      const count = await fetchHistoricalRange(
        broker,
        pair,
        gran,
        '2019-01-01T00:00:00Z',
        new Date().toISOString()
      );
      console.log(`Done: ${count} candles stored for ${pair} ${gran}`);
    }
  }

  await disconnectDB();
  console.log('\nSeed complete.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
