import { Router, type Request, type Response } from 'express';
import type { RiskEngine } from '../risk/RiskEngine.js';
import type { StreamHealthMonitor } from '../risk/StreamHealthMonitor.js';
import type { RiskLimits } from '../risk/types.js';

export function createRiskRoutes(riskEngine: RiskEngine, streamMonitor: StreamHealthMonitor): Router {
  const router = Router();

  router.get('/state', (_req: Request, res: Response) => {
    res.json({
      risk: riskEngine.getState(),
      stream: streamMonitor.getStatus(),
    });
  });

  router.post('/check-entry', (req: Request, res: Response) => {
    const { spreadPips } = req.body;
    const result = riskEngine.checkEntryAllowed(spreadPips);
    res.json(result);
  });

  router.post('/reset-circuit-breaker', (_req: Request, res: Response) => {
    riskEngine.resetCircuitBreaker();
    res.json({ reset: true, state: riskEngine.getState() });
  });

  router.put('/limits', (req: Request, res: Response) => {
    const updates: Partial<RiskLimits> = req.body;
    riskEngine.updateLimits(updates);
    res.json({ limits: riskEngine.getState().limits });
  });

  return router;
}
