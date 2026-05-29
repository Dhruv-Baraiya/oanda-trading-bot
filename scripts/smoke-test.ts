import { readFileSync } from 'fs';
import { resolve } from 'path';
import { OandaAdapter } from '../packages/backend/src/broker/OandaAdapter.js';

const envPath = resolve(__dirname, '../.env');
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

async function main() {
  const token = process.env.OANDA_API_TOKEN!;
  const accountId = process.env.OANDA_ACCOUNT_ID!;
  const baseUrl = process.env.OANDA_BASE_URL ?? 'https://api-fxpractice.oanda.com';

  const broker = new OandaAdapter({ apiToken: token, accountId, baseUrl });

  console.log('=== SMOKE TEST ===\n');

  // 1. Account summary
  console.log('1. Fetching account summary...');
  const account = await broker.getAccountSummary();
  console.log(`   Balance: $${account.balance} | NAV: $${account.nav} | Open trades: ${account.openTradeCount}\n`);

  // 2. Fetch 5 recent candles
  console.log('2. Fetching 5 recent EUR/USD H1 candles...');
  const candles = await broker.getCandles({ instrument: 'EUR_USD', granularity: 'H1', count: 5 });
  candles.forEach(c => console.log(`   ${c.timestamp} | O:${c.open} H:${c.high} L:${c.low} C:${c.close}`));
  console.log();

  // 3. Place 1-unit market buy
  console.log('3. Placing 1-unit EUR/USD market BUY...');
  const order = await broker.placeOrder({
    instrument: 'EUR_USD',
    units: 1,
    type: 'MARKET',
  });
  console.log(`   Order ${order.orderId} | Trade ${order.tradeId} | Price: ${order.price} | State: ${order.state}\n`);

  // 4. Verify open trades
  console.log('4. Checking open trades...');
  const trades = await broker.getOpenTrades();
  trades.forEach(t => console.log(`   Trade ${t.tradeId} | ${t.instrument} | ${t.units} units @ ${t.price}`));
  console.log();

  // 5. Close the trade
  if (order.tradeId) {
    console.log(`5. Closing trade ${order.tradeId}...`);
    const closed = await broker.closeTrade(order.tradeId);
    console.log(`   Closed @ ${closed.price} | P&L: ${closed.pl}\n`);
  }

  // 6. Verify no open trades
  console.log('6. Verifying no open trades...');
  const remaining = await broker.getOpenTrades();
  console.log(`   Open trades: ${remaining.length}\n`);

  // 7. Test kill switch
  console.log('7. Testing kill switch (should be no-op)...');
  const killResults = await broker.closeAllTrades();
  await broker.cancelAllOrders();
  console.log(`   Kill switch closed ${killResults.length} trades, cancelled all pending orders\n`);

  console.log('=== SMOKE TEST PASSED ===');
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err.message);
  process.exit(1);
});
