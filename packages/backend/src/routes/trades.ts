import { Router, type Request, type Response } from 'express';
import type { BrokerAdapter } from '../broker/BrokerAdapter.js';
import { TradeModel } from '../data/models.js';

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

  router.get('/history', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const trades = await TradeModel.find().sort({ openTime: -1 }).limit(limit).lean();
      res.json({ count: trades.length, trades });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/sync', async (_req: Request, res: Response) => {
    try {
      const closedTrades = await broker.getClosedTrades();
      let synced = 0;
      for (const t of closedTrades) {
        const exists = await TradeModel.findOne({ tradeId: t.tradeId });
        if (!exists) {
          await TradeModel.create({
            tradeId: t.tradeId,
            instrument: t.instrument,
            units: t.units,
            entryPrice: t.entryPrice,
            exitPrice: t.exitPrice,
            stopLoss: t.stopLossPrice,
            takeProfit: t.takeProfitPrice,
            openTime: new Date(t.openTime),
            closeTime: new Date(t.closeTime),
            pl: t.pl,
            state: 'CLOSED',
            signals: [],
          });
          synced++;
        }
      }
      res.json({ synced, total: closedTrades.length });
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
