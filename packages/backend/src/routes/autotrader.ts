import { Router, type Request, type Response } from 'express';
import type { AutoTrader } from '../autotrader/AutoTrader.js';
import { DecisionLogModel } from '../data/DecisionLog.js';

export function createAutoTraderRoutes(autoTrader: AutoTrader): Router {
  const router = Router();

  router.get('/status', (_req: Request, res: Response) => {
    res.json(autoTrader.getStatus());
  });

  router.post('/start', async (req: Request, res: Response) => {
    try {
      const intervalMs = req.body.intervalMs ?? 60000;
      await autoTrader.start(intervalMs);
      res.json({ started: true, status: autoTrader.getStatus() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/stop', async (_req: Request, res: Response) => {
    try {
      await autoTrader.stop();
      res.json({ stopped: true, status: autoTrader.getStatus() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/decisions', async (req: Request, res: Response) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const type = req.query.type as string;
      const instrument = req.query.instrument as string;
      const strategyId = req.query.strategyId as string;

      const filter: Record<string, any> = {};
      if (type) filter.type = type;
      if (instrument) filter.instrument = instrument;
      if (strategyId) filter.strategyId = strategyId;

      const decisions = await DecisionLogModel.find(filter)
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean();

      res.json({ count: decisions.length, decisions });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/ml/status', async (_req: Request, res: Response) => {
    const mlUrl = process.env.ML_SERVICE_URL || 'http://localhost:8000';
    try {
      const [health, status] = await Promise.all([
        fetch(`${mlUrl}/health`, { signal: AbortSignal.timeout(2000) }).then(r => r.json()).catch(() => null),
        fetch(`${mlUrl}/model/status`, { signal: AbortSignal.timeout(2000) }).then(r => r.json()).catch(() => null),
      ]);
      res.json({ online: !!health, model_loaded: health?.model_loaded ?? false, training: status });
    } catch {
      res.json({ online: false, model_loaded: false, training: null });
    }
  });

  router.delete('/decisions', async (req: Request, res: Response) => {
    try {
      const type = req.query.type as string;
      const filter: Record<string, any> = {};
      if (type) filter.type = type;
      const result = await DecisionLogModel.deleteMany(filter);
      res.json({ deleted: result.deletedCount });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
