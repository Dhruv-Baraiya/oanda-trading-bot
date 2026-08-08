import { Router, type Request, type Response } from 'express';
import type { DataCollector } from '../data/DataCollector.js';
import type { CandleGranularity } from '../broker/types.js';
import { CandleModel, SentimentModel } from '../data/models.js';

export function createDataCollectorRoutes(collector: DataCollector): Router {
  const router = Router();

  router.get('/status', (_req: Request, res: Response) => {
    res.json(collector.getStats());
  });

  router.post('/start', async (_req: Request, res: Response) => {
    try {
      await collector.start();
      res.json({ started: true, ...collector.getStats() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/stop', (_req: Request, res: Response) => {
    collector.stop();
    res.json({ stopped: true, ...collector.getStats() });
  });

  router.post('/backfill', async (req: Request, res: Response) => {
    try {
      const { instrument = 'EUR_USD', granularity = 'H1', count = 5000, from, to } = req.body;

      if (from && to) {
        const saved = await collector.backfillDateRange(
          instrument,
          granularity as CandleGranularity,
          from,
          to,
          (saved, batch) => console.log(`[Backfill] ${instrument}/${granularity} batch ${batch}: ${saved} candles saved`),
        );
        res.json({ saved, instrument, granularity, from, to });
      } else {
        const saved = await collector.backfillCandles(
          instrument,
          granularity as CandleGranularity,
          Math.min(count, 5000)
        );
        res.json({ saved, instrument, granularity });
      }
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/candles/count', async (req: Request, res: Response) => {
    try {
      const instrument = req.query.instrument as string;
      const granularity = req.query.granularity as string;
      const filter: Record<string, any> = {};
      if (instrument) filter.instrument = instrument;
      if (granularity) filter.granularity = granularity;

      const counts = await CandleModel.aggregate([
        { $match: filter },
        { $group: { _id: { instrument: '$instrument', granularity: '$granularity' }, count: { $sum: 1 }, oldest: { $min: '$timestamp' }, newest: { $max: '$timestamp' } } },
        { $sort: { '_id.instrument': 1, '_id.granularity': 1 } },
      ]);

      res.json({ counts });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/sentiment/count', async (_req: Request, res: Response) => {
    try {
      const counts = await SentimentModel.aggregate([
        { $group: { _id: { instrument: '$instrument', source: '$source' }, count: { $sum: 1 }, oldest: { $min: '$timestamp' }, newest: { $max: '$timestamp' } } },
        { $sort: { '_id.instrument': 1, '_id.source': 1 } },
      ]);
      res.json({ counts });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
