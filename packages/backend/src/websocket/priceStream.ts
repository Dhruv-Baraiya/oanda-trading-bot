import type { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import type { BrokerAdapter } from '../broker/BrokerAdapter.js';
import { RiskEngine } from '../risk/RiskEngine.js';
import { StreamHealthMonitor } from '../risk/StreamHealthMonitor.js';

export interface StreamContext {
  io: SocketServer;
  riskEngine: RiskEngine;
  streamMonitor: StreamHealthMonitor;
}

export function setupPriceStream(httpServer: HttpServer, broker: BrokerAdapter): StreamContext {
  const io = new SocketServer(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  const riskEngine = new RiskEngine();
  const streamMonitor = new StreamHealthMonitor(broker);

  const activeInstruments = new Set<string>();
  let accountInterval: ReturnType<typeof setInterval> | null = null;

  async function pushAccountAndTrades() {
    try {
      const [summary, trades, orders] = await Promise.all([
        broker.getAccountSummary(),
        broker.getOpenTrades(),
        broker.getPendingOrders(),
      ]);

      riskEngine.updateAccount(summary);

      io.emit('account', summary);
      io.emit('trades', trades);
      io.emit('orders', orders);
      io.emit('riskState', riskEngine.getState());
      io.emit('streamHealth', streamMonitor.getStatus());
    } catch {}
  }

  function startAccountPush() {
    if (accountInterval) return;

    broker.getAccountSummary()
      .then(account => riskEngine.initialize(account))
      .catch(() => {});

    pushAccountAndTrades();
    accountInterval = setInterval(pushAccountAndTrades, 10000);
  }

  function stopAccountPush() {
    if (accountInterval) {
      clearInterval(accountInterval);
      accountInterval = null;
    }
  }

  riskEngine.on('circuit-breaker', (data) => {
    console.log(`[RISK] Circuit breaker: ${data.tripped ? 'TRIPPED' : 'RESET'} — ${data.reason ?? 'cleared'}`);
    io.emit('riskState', riskEngine.getState());
  });

  riskEngine.on('drawdown-breaker', (data) => {
    console.log(`[RISK] DRAWDOWN BREAKER — ${(data.drawdownPercent * 100).toFixed(2)}%`);
    io.emit('riskAlert', { type: 'drawdown', ...data });
  });

  riskEngine.on('daily-limit', (data) => {
    console.log(`[RISK] Daily loss limit — ${(data.lossPct * 100).toFixed(2)}%`);
    io.emit('riskAlert', { type: 'daily-limit', ...data });
  });

  riskEngine.on('weekly-limit', (data) => {
    console.log(`[RISK] Weekly loss limit — ${(data.lossPct * 100).toFixed(2)}%`);
    io.emit('riskAlert', { type: 'weekly-limit', ...data });
  });

  streamMonitor.on('state-change', ({ from, to }) => {
    console.log(`[STREAM] ${from} → ${to}`);
    io.emit('streamHealth', streamMonitor.getStatus());
  });

  streamMonitor.on('reconnecting', ({ attempt, max }) => {
    console.log(`[STREAM] Reconnecting ${attempt}/${max}`);
  });

  streamMonitor.on('stale', ({ elapsed }) => {
    console.log(`[STREAM] Stale — no tick for ${(elapsed / 1000).toFixed(1)}s`);
  });

  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);
    startAccountPush();

    socket.emit('riskState', riskEngine.getState());
    socket.emit('streamHealth', streamMonitor.getStatus());

    socket.on('subscribe', (instruments: string[]) => {
      for (const inst of instruments) {
        activeInstruments.add(inst);
      }
      restartStream();
    });

    socket.on('unsubscribe', (instruments: string[]) => {
      for (const inst of instruments) {
        activeInstruments.delete(inst);
      }
      if (activeInstruments.size === 0) {
        streamMonitor.stop();
      } else {
        restartStream();
      }
    });

    socket.on('requestRefresh', () => {
      pushAccountAndTrades();
    });

    socket.on('resetCircuitBreaker', () => {
      riskEngine.resetCircuitBreaker();
      console.log(`[RISK] Circuit breaker manually reset by client`);
    });

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
      if (io.engine.clientsCount === 0) {
        streamMonitor.stop();
        activeInstruments.clear();
        stopAccountPush();
      }
    });
  });

  function restartStream() {
    const instruments = Array.from(activeInstruments);
    if (instruments.length === 0) return;

    streamMonitor.stop();
    streamMonitor.start(instruments, (price) => {
      riskEngine.onPriceTick(price);
      io.emit('price', price);
    });
  }

  return { io, riskEngine, streamMonitor };
}
