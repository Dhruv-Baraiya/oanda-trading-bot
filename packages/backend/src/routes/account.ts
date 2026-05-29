import { Router, type Request, type Response } from 'express';
import type { BrokerAdapter } from '../broker/BrokerAdapter.js';

export function createAccountRoutes(broker: BrokerAdapter): Router {
  const router = Router();

  router.get('/summary', async (_req: Request, res: Response) => {
    try {
      const summary = await broker.getAccountSummary();
      res.json(summary);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
