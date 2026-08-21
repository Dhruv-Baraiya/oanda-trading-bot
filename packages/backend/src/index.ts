import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { createServer } from 'http';

import { OandaAdapter } from './broker/OandaAdapter.js';
import { createCandleRoutes } from './routes/candles.js';
import { createAccountRoutes } from './routes/account.js';
import { createTradeRoutes } from './routes/trades.js';
import { createOrderRoutes } from './routes/orders.js';
import { createKillSwitchRoutes } from './routes/killswitch.js';
import { createInstrumentRoutes } from './routes/instruments.js';
import { createStrategyRoutes } from './routes/strategies.js';
import { createBacktestRoutes } from './routes/backtest.js';
import { createRiskRoutes } from './routes/risk.js';
import { createAutoTraderRoutes } from './routes/autotrader.js';
import { AutoTrader } from './autotrader/AutoTrader.js';
import { DataCollector } from './data/DataCollector.js';
import { createDataCollectorRoutes } from './routes/datacollector.js';
import { createMigrateRoutes } from './routes/migrate.js';
import { connectDB } from './data/db.js';
import { setupPriceStream } from './websocket/priceStream.js';

// Load .env: Docker sets env vars directly; local dev reads from repo root
const envPath = process.env.NODE_ENV === 'production'
  ? undefined
  : path.resolve(__dirname, '../../../.env');
if (envPath) dotenv.config({ path: envPath });

const PORT = parseInt(process.env.PORT || '3001');
const apiToken = process.env.OANDA_API_TOKEN;
const accountId = process.env.OANDA_ACCOUNT_ID;
const baseUrl = process.env.OANDA_BASE_URL || 'https://api-fxpractice.oanda.com';

if (!apiToken || !accountId) {
  console.error('Missing OANDA_API_TOKEN or OANDA_ACCOUNT_ID in .env');
  process.exit(1);
}

const broker = new OandaAdapter({ apiToken, accountId, baseUrl });

const app: express.Express = express();
const httpServer = createServer(app);

app.use(cors());
app.use(express.json());

const startTime = Date.now();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.floor((Date.now() - startTime) / 1000), timestamp: new Date().toISOString() });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.floor((Date.now() - startTime) / 1000), timestamp: new Date().toISOString() });
});

app.use('/api/candles', createCandleRoutes(broker));
app.use('/api/account', createAccountRoutes(broker));
app.use('/api/trades', createTradeRoutes(broker));
app.use('/api/orders', createOrderRoutes(broker));
app.use('/api/killswitch', createKillSwitchRoutes(broker));
app.use('/api/instruments', createInstrumentRoutes(broker));
app.use('/api/strategies', createStrategyRoutes(broker));
app.use('/api/backtest', createBacktestRoutes(broker));

const { io, riskEngine, streamMonitor } = setupPriceStream(httpServer, broker);

app.use('/api/risk', createRiskRoutes(riskEngine, streamMonitor));

const autoTrader = new AutoTrader(broker, riskEngine);

autoTrader.on('status', (status) => {
  io.emit('autoTraderStatus', status);
});

autoTrader.on('decision', (decision) => {
  io.emit('decision', decision);
});

autoTrader.on('trade', (data) => {
  io.emit('autoTrade', data);
  console.log(`[AutoTrader] ${data.type}: ${data.strategy} — ${JSON.stringify(data.order ?? data.result)}`);
});

app.use('/api/autotrader', createAutoTraderRoutes(autoTrader));

const dataCollector = new DataCollector(broker);
app.use('/api/datacollector', createDataCollectorRoutes(dataCollector));
app.use('/api/migrate', createMigrateRoutes());

async function start() {
  try {
    await connectDB();
  } catch (err: any) {
    console.warn(`MongoDB not connected (${err.message}) — strategies will not persist`);
  }

  httpServer.listen(PORT, () => {
    console.log(`Trading bot API running on port ${PORT}`);
    console.log(`WebSocket server ready`);
    console.log(`Account: ${accountId}`);
  });
}

start();

export { app, io, broker, riskEngine, streamMonitor, autoTrader, dataCollector };
