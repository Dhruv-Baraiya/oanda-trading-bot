import { Router, type Request, type Response } from 'express';
import type { DataCollector } from '../data/DataCollector.js';
import type { CandleGranularity } from '../broker/types.js';
import { SentimentModel } from '../data/models.js';
import { D1CandleClient } from '../data/D1Client.js';

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

  // Background backfill — returns immediately, runs in background
  let _backfillStatus: { running: boolean; instrument: string; granularity: string; saved: number; batch: number; error?: string } = {
    running: false, instrument: '', granularity: '', saved: 0, batch: 0,
  };

  router.post('/backfill/background', (req: Request, res: Response) => {
    if (_backfillStatus.running) {
      res.json({ error: 'Backfill already running', status: _backfillStatus });
      return;
    }

    const { instrument = 'EUR_USD', granularity = 'M15', from, to } = req.body;
    if (!from || !to) {
      res.status(400).json({ error: 'from and to required' });
      return;
    }

    _backfillStatus = { running: true, instrument, granularity, saved: 0, batch: 0 };

    collector.backfillDateRange(
      instrument,
      granularity as CandleGranularity,
      from,
      to,
      (saved, batch) => {
        _backfillStatus.saved = saved;
        _backfillStatus.batch = batch;
        console.log(`[Backfill] ${instrument}/${granularity} batch ${batch}: ${saved} candles saved`);
      },
    ).then((total) => {
      _backfillStatus.running = false;
      _backfillStatus.saved = total;
      console.log(`[Backfill] Complete: ${total} candles`);
    }).catch((err) => {
      _backfillStatus.running = false;
      _backfillStatus.error = err.message;
      console.error(`[Backfill] Error:`, err.message);
    });

    res.json({ started: true, status: _backfillStatus });
  });

  router.get('/backfill/status', (_req: Request, res: Response) => {
    res.json(_backfillStatus);
  });

  router.get('/candles/count', async (req: Request, res: Response) => {
    try {
      const instrument = req.query.instrument as string;
      const granularity = req.query.granularity as string;
      const filter: Record<string, any> = {};
      if (instrument) filter.instrument = instrument;
      if (granularity) filter.granularity = granularity;

      const counts = await D1CandleClient.count(
        instrument || undefined,
        granularity || undefined
      );

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
