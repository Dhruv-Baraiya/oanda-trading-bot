import { Router, type Request, type Response } from 'express';
import type { BrokerAdapter } from '../broker/BrokerAdapter.js';
import type { CandleGranularity } from '../broker/types.js';
import { IndicatorEngine } from '../indicators/IndicatorEngine.js';

const VALID_GRANULARITIES = new Set([
  'S5','S10','S15','S30','M1','M2','M4','M5','M10','M15','M30',
  'H1','H2','H3','H4','H6','H8','H12','D','W','M',
]);

export function createCandleRoutes(broker: BrokerAdapter): Router {
  const router = Router();
  const engine = new IndicatorEngine();

  router.get('/:instrument', async (req: Request, res: Response) => {
    try {
      const { instrument } = req.params;
      const granularity = (req.query.granularity as string) || 'H1';
      const count = Math.min(parseInt(req.query.count as string) || 300, 5000);

      if (!VALID_GRANULARITIES.has(granularity)) {
        res.status(400).json({ error: `Invalid granularity: ${granularity}` });
        return;
      }

      const candles = await broker.getCandles({
        instrument,
        granularity: granularity as CandleGranularity,
        count,
      });

      res.json({ instrument, granularity, count: candles.length, candles });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/:instrument/indicators', async (req: Request, res: Response) => {
    try {
      const { instrument } = req.params;
      const granularity = (req.query.granularity as string) || 'H1';
      const count = Math.min(parseInt(req.query.count as string) || 300, 5000);

      if (!VALID_GRANULARITIES.has(granularity)) {
        res.status(400).json({ error: `Invalid granularity: ${granularity}` });
        return;
      }

      const candles = await broker.getCandles({
        instrument,
        granularity: granularity as CandleGranularity,
        count,
      });

      const snapshots = engine.compute(candles);

      res.json({
        instrument,
        granularity,
        count: snapshots.length,
        indicators: snapshots,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
