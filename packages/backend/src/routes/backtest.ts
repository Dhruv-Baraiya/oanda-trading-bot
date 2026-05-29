import { Router, type Request, type Response } from 'express';
import type { BrokerAdapter } from '../broker/BrokerAdapter.js';
import { StrategyModel } from '../strategies/models.js';
import { BacktestResultModel } from '../data/models.js';
import { HistoricalDataPipeline } from '../data/HistoricalDataPipeline.js';
import { BacktestEngine } from '../backtest/BacktestEngine.js';
import type { CandleGranularity } from '../broker/types.js';

export function createBacktestRoutes(broker: BrokerAdapter): Router {
  const router = Router();
  const pipeline = new HistoricalDataPipeline(broker);
  const engine = new BacktestEngine();

  router.post('/run', async (req: Request, res: Response) => {
    try {
      const {
        strategyId,
        from,
        to,
        initialBalance = 10000,
        spreadPips = 1.0,
        slippagePips = 0.3,
      } = req.body;

      if (!strategyId || !from || !to) {
        res.status(400).json({ error: 'strategyId, from, to required' });
        return;
      }

      const strategy = await StrategyModel.findById(strategyId).lean();
      if (!strategy) {
        res.status(404).json({ error: 'Strategy not found' });
        return;
      }

      const fromDate = new Date(from);
      const toDate = new Date(to);

      await pipeline.download(
        strategy.instrument,
        strategy.granularity as CandleGranularity,
        fromDate,
        toDate
      );

      const candles = await pipeline.getStoredCandles(
        strategy.instrument,
        strategy.granularity,
        fromDate,
        toDate
      );

      if (candles.length < 250) {
        res.status(400).json({ error: `Not enough data: ${candles.length} candles (need 250+)` });
        return;
      }

      const config = {
        strategyId,
        instrument: strategy.instrument,
        granularity: strategy.granularity,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        initialBalance,
        spreadPips,
        slippagePips,
      };

      const result = engine.run(strategy as any, candles, config);

      const saved = await BacktestResultModel.create({
        strategyId,
        strategyName: strategy.name,
        instrument: strategy.instrument,
        granularity: strategy.granularity,
        from: fromDate,
        to: toDate,
        initialBalance,
        endBalance: result.endBalance,
        spreadPips,
        slippagePips,
        metrics: result.metrics,
        trades: result.trades,
        equityCurve: result.equityCurve.map(e => ({
          timestamp: new Date(e.timestamp),
          equity: e.equity,
          drawdown: e.drawdown,
        })),
        runAt: new Date(),
      });

      res.json({ ...result, _id: saved._id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/results', async (_req: Request, res: Response) => {
    try {
      const results = await BacktestResultModel.find()
        .sort({ runAt: -1 })
        .limit(20)
        .select('-trades -equityCurve')
        .lean();
      res.json({ results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/results/:id', async (req: Request, res: Response) => {
    try {
      const result = await BacktestResultModel.findById(req.params.id).lean();
      if (!result) {
        res.status(404).json({ error: 'Result not found' });
        return;
      }
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/results/:id', async (req: Request, res: Response) => {
    try {
      await BacktestResultModel.findByIdAndDelete(req.params.id);
      res.json({ deleted: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/data-status/:instrument/:granularity', async (req: Request, res: Response) => {
    try {
      const range = await pipeline.getStoredRange(req.params.instrument, req.params.granularity);
      res.json({ range });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/download-data', async (req: Request, res: Response) => {
    try {
      const { instrument, granularity, from, to } = req.body;
      if (!instrument || !granularity || !from || !to) {
        res.status(400).json({ error: 'instrument, granularity, from, to required' });
        return;
      }

      const result = await pipeline.download(
        instrument,
        granularity as CandleGranularity,
        new Date(from),
        new Date(to)
      );

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
