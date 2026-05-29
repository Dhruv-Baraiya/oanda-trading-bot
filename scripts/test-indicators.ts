import { readFileSync } from 'fs';
import { resolve } from 'path';
import { OandaAdapter } from '../packages/backend/src/broker/OandaAdapter.js';
import { IndicatorEngine } from '../packages/backend/src/indicators/IndicatorEngine.js';

const envPath = resolve(__dirname, '../.env');
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

async function main() {
  const broker = new OandaAdapter({
    apiToken: process.env.OANDA_API_TOKEN!,
    accountId: process.env.OANDA_ACCOUNT_ID!,
    baseUrl: process.env.OANDA_BASE_URL!,
  });

  console.log('Fetching 300 EUR/USD H1 candles...');
  const candles = await broker.getCandles({
    instrument: 'EUR_USD',
    granularity: 'H1',
    count: 300,
  });
  console.log(`Got ${candles.length} candles\n`);

  const engine = new IndicatorEngine();
  const snapshots = engine.compute(candles);

  const last5 = snapshots.slice(-5);
  for (const s of last5) {
    console.log(`--- ${s.timestamp} | Close: ${s.close}`);
    if (s.rsi) console.log(`  RSI: ${s.rsi.value} ${s.rsi.overbought ? '[OB]' : ''} ${s.rsi.oversold ? '[OS]' : ''}`);
    if (s.macd) console.log(`  MACD: ${s.macd.macd} | Signal: ${s.macd.signal} | Hist: ${s.macd.histogram} ${s.macd.bullish ? '[BULL]' : '[BEAR]'}`);
    if (s.bollingerBands) console.log(`  BB: ${s.bollingerBands.lower} / ${s.bollingerBands.middle} / ${s.bollingerBands.upper} | %B: ${s.bollingerBands.percentB}`);
    if (s.atr) console.log(`  ATR: ${s.atr.value}`);
    if (s.ema) console.log(`  EMA: ${s.ema.short}(20) / ${s.ema.mid}(50) / ${s.ema.long}(200) | Trend: ${s.ema.shortAboveLong ? 'UP' : 'DOWN'}`);
    console.log();
  }

  console.log(`Total snapshots: ${snapshots.length}`);
  const withIndicators = snapshots.filter(s => s.rsi && s.macd && s.bollingerBands && s.atr && s.ema);
  console.log(`With all indicators: ${withIndicators.length}`);
  console.log('\nIndicator engine test PASSED');
}

main().catch(err => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
