import { Router, type Request, type Response } from 'express';
import { CandleModel } from '../data/models.js';

const D1_WORKER_URL = process.env.D1_WORKER_URL || 'http://localhost:8787';
const D1_API_KEY = process.env.D1_API_KEY || '';

interface MigrationStatus {
  running: boolean;
  instrument: string;
  granularity: string;
  migrated: number;
  total: number;
  currentGroup: string;
  groups: { instrument: string; granularity: string; count: number; done: boolean }[];
  startedAt: string | null;
  error: string | null;
}

const status: MigrationStatus = {
  running: false,
  instrument: '',
  granularity: '',
  migrated: 0,
  total: 0,
  currentGroup: '',
  groups: [],
  startedAt: null,
  error: null,
};

export function createMigrateRoutes(): Router {
  const router = Router();

  router.get('/status', (_req: Request, res: Response) => {
    res.json(status);
  });

  router.post('/candles-to-d1', async (req: Request, res: Response) => {
    if (status.running) {
      res.json({ error: 'Migration already running', status });
      return;
    }

    const skipM1 = req.body?.skipM1 !== false; // default: skip M1
    const batchSize = Math.min(req.body?.batchSize || 500, 1000);

    res.json({ started: true, skipM1, batchSize, message: 'Check GET /api/migrate/status for progress' });

    runMigration(skipM1, batchSize).catch((err) => {
      status.error = err.message;
      status.running = false;
      console.error('[Migration] Fatal error:', err.message);
    });
  });

  router.post('/stop', (_req: Request, res: Response) => {
    if (!status.running) {
      res.json({ error: 'No migration running' });
      return;
    }
    status.running = false;
    res.json({ stopped: true, status });
  });

  return router;
}

async function runMigration(skipM1: boolean, batchSize: number) {
  status.running = true;
  status.migrated = 0;
  status.error = null;
  status.startedAt = new Date().toISOString();

  const headers = {
    'Content-Type': 'application/json',
    'X-API-Key': D1_API_KEY,
  };

  const matchFilter: Record<string, any> = {};
  if (skipM1) {
    matchFilter.granularity = { $ne: 'M1' };
  }

  const groups = await CandleModel.aggregate([
    { $match: matchFilter },
    { $group: { _id: { instrument: '$instrument', granularity: '$granularity' }, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
  ]);

  status.total = groups.reduce((s: number, g: any) => s + g.count, 0);
  status.groups = groups.map((g: any) => ({
    instrument: g._id.instrument,
    granularity: g._id.granularity,
    count: g.count,
    done: false,
  }));

  console.log(`[Migration] Starting: ${groups.length} groups, ${status.total} candles, skipM1=${skipM1}`);

  for (let gi = 0; gi < groups.length; gi++) {
    if (!status.running) {
      console.log('[Migration] Stopped by user');
      return;
    }

    const group = groups[gi];
    const instrument = group._id.instrument;
    const granularity = group._id.granularity;
    status.instrument = instrument;
    status.granularity = granularity;
    status.currentGroup = `${instrument}/${granularity}`;

    console.log(`[Migration] ${instrument}/${granularity}: ${group.count} candles`);

    const cursor = CandleModel.find({ instrument, granularity })
      .sort({ timestamp: 1 })
      .lean()
      .cursor();

    let batch: any[] = [];

    for await (const doc of cursor) {
      if (!status.running) {
        console.log('[Migration] Stopped by user');
        return;
      }

      batch.push({
        instrument,
        granularity,
        timestamp: doc.timestamp.toISOString(),
        open: doc.open,
        high: doc.high,
        low: doc.low,
        close: doc.close,
        volume: doc.volume,
      });

      if (batch.length >= batchSize) {
        await sendBatch(batch, headers);
        status.migrated += batch.length;
        batch = [];

        if (status.migrated % 5000 < batchSize) {
          console.log(`[Migration] ${status.migrated}/${status.total} (${status.currentGroup})`);
        }

        await delay(50);
      }
    }

    if (batch.length > 0) {
      await sendBatch(batch, headers);
      status.migrated += batch.length;
      batch = [];
    }

    status.groups[gi].done = true;
    console.log(`[Migration] ${instrument}/${granularity} done`);
  }

  status.running = false;
  console.log(`[Migration] Complete: ${status.migrated} candles migrated`);
}

async function sendBatch(batch: any[], headers: Record<string, string>, retries = 3): Promise<void> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${D1_WORKER_URL}/candles`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ candles: batch }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`D1 Worker ${res.status}: ${text}`);
      }
      return;
    } catch (err: any) {
      if (attempt === retries - 1) throw err;
      console.warn(`[Migration] Retry ${attempt + 1}: ${err.message}`);
      await delay(1000 * (attempt + 1));
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
