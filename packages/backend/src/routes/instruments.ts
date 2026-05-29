import { Router, type Request, type Response } from 'express';
import type { BrokerAdapter } from '../broker/BrokerAdapter.js';

export function createInstrumentRoutes(broker: BrokerAdapter): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const instruments = await broker.getInstruments();
      res.json({ count: instruments.length, instruments });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
