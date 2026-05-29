import { Router, type Request, type Response } from 'express';
import type { BrokerAdapter } from '../broker/BrokerAdapter.js';
import type { CandleGranularity } from '../broker/types.js';
import { StrategyModel } from '../strategies/models.js';
import { SignalEngine } from '../strategies/SignalEngine.js';
import { IndicatorEngine } from '../indicators/IndicatorEngine.js';
import { SignalModel } from '../data/models.js';

export function createStrategyRoutes(broker: BrokerAdapter): Router {
  const router = Router();
  const signalEngine = new SignalEngine();
  const indicatorEngine = new IndicatorEngine();

  // List all strategies
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const strategies = await StrategyModel.find().sort({ createdAt: -1 });
      res.json({ count: strategies.length, strategies });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get single strategy
  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const strategy = await StrategyModel.findById(req.params.id);
      if (!strategy) { res.status(404).json({ error: 'Strategy not found' }); return; }
      res.json(strategy);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create strategy
  router.post('/', async (req: Request, res: Response) => {
    try {
      const strategy = new StrategyModel(req.body);
      await strategy.save();
      res.status(201).json(strategy);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Update strategy
  router.put('/:id', async (req: Request, res: Response) => {
    try {
      const strategy = await StrategyModel.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true, runValidators: true }
      );
      if (!strategy) { res.status(404).json({ error: 'Strategy not found' }); return; }
      res.json(strategy);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // Delete strategy
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      const strategy = await StrategyModel.findByIdAndDelete(req.params.id);
      if (!strategy) { res.status(404).json({ error: 'Strategy not found' }); return; }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Toggle enabled
  router.post('/:id/toggle', async (req: Request, res: Response) => {
    try {
      const strategy = await StrategyModel.findById(req.params.id);
      if (!strategy) { res.status(404).json({ error: 'Strategy not found' }); return; }
      strategy.enabled = !strategy.enabled;
      await strategy.save();
      res.json({ enabled: strategy.enabled });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Evaluate strategy now — generate signal from live data
  router.post('/:id/evaluate', async (req: Request, res: Response) => {
    try {
      const strategy = await StrategyModel.findById(req.params.id);
      if (!strategy) { res.status(404).json({ error: 'Strategy not found' }); return; }

      const candles = await broker.getCandles({
        instrument: strategy.instrument,
        granularity: strategy.granularity as CandleGranularity,
        count: 300,
      });

      const snapshots = indicatorEngine.compute(candles);
      if (snapshots.length < 2) {
        res.json({ signal: null, message: 'Not enough data' });
        return;
      }

      const current = snapshots[snapshots.length - 1];
      const previous = snapshots[snapshots.length - 2];
      const signal = signalEngine.evaluate(strategy.toObject(), current, previous);

      if (signal) {
        signal.strategyId = strategy._id.toString();
        await SignalModel.create(signal);
      }

      res.json({ signal });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get signal history
  router.get('/:id/signals', async (req: Request, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const signals = await SignalModel.find({ strategyId: req.params.id })
        .sort({ timestamp: -1 })
        .limit(limit);
      res.json({ count: signals.length, signals });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get all recent signals
  router.get('/signals/recent', async (_req: Request, res: Response) => {
    try {
      const signals = await SignalModel.find()
        .sort({ timestamp: -1 })
        .limit(50);
      res.json({ count: signals.length, signals });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Review signal (Good/Bad)
  router.post('/signals/:signalId/review', async (req: Request, res: Response) => {
    try {
      const { review, reviewNotes } = req.body;
      if (!['GOOD', 'BAD'].includes(review)) {
        res.status(400).json({ error: 'review must be GOOD or BAD' });
        return;
      }
      const signal = await SignalModel.findByIdAndUpdate(
        req.params.signalId,
        { review, reviewNotes },
        { new: true }
      );
      if (!signal) { res.status(404).json({ error: 'Signal not found' }); return; }
      res.json(signal);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
