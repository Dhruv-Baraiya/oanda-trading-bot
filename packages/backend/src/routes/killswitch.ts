import { Router, type Request, type Response } from 'express';
import type { BrokerAdapter } from '../broker/BrokerAdapter.js';

export function createKillSwitchRoutes(broker: BrokerAdapter): Router {
  const router = Router();

  router.post('/activate', async (_req: Request, res: Response) => {
    try {
      const startTime = Date.now();
      const closedTrades = await broker.closeAllTrades();
      await broker.cancelAllOrders();
      const elapsed = Date.now() - startTime;

      res.json({
        success: true,
        closedTrades: closedTrades.length,
        trades: closedTrades,
        elapsedMs: elapsed,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
