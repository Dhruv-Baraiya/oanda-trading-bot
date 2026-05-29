import { Router, type Request, type Response } from 'express';
import type { BrokerAdapter } from '../broker/BrokerAdapter.js';

export function createTradeRoutes(broker: BrokerAdapter): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const trades = await broker.getOpenTrades();
      res.json({ count: trades.length, trades });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/close/:tradeId', async (req: Request, res: Response) => {
    try {
      const { tradeId } = req.params;
      const units = req.body.units ? parseInt(req.body.units) : undefined;
      try {
        const result = await broker.closeTrade(tradeId, units);
        res.json(result);
      } catch (err: any) {
        if (err.message?.includes('FIFO_VIOLATION')) {
          const allTrades = await broker.getOpenTrades();
          const target = allTrades.find(t => t.tradeId === tradeId);
          if (!target) throw new Error('Trade not found');
          const oldest = allTrades
            .filter(t => t.instrument === target.instrument)
            .sort((a, b) => new Date(a.openTime).getTime() - new Date(b.openTime).getTime())[0];
          if (!oldest) throw new Error('No trades to close');
          const result = await broker.closeTrade(oldest.tradeId, units);
          res.json({ ...result, fifoNote: `Closed oldest trade ${oldest.tradeId} instead (FIFO rule)` });
        } else {
          throw err;
        }
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/modify/:tradeId', async (req: Request, res: Response) => {
    try {
      const { tradeId } = req.params;
      const { stopLoss, takeProfit } = req.body;
      await broker.modifyTrade(
        tradeId,
        stopLoss ? parseFloat(stopLoss) : undefined,
        takeProfit ? parseFloat(takeProfit) : undefined,
      );
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
