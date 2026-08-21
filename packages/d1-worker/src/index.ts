export interface Env {
  DB: D1Database;
  MODELS?: R2Bucket;
  API_KEY: string;
}

interface CandleRow {
  instrument: string;
  granularity: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function err(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (path === "/health") {
      return json({ status: "ok", service: "d1-worker" });
    }

    const apiKey = request.headers.get("X-API-Key");
    if (apiKey !== env.API_KEY) {
      return err("Unauthorized", 401);
    }

    try {
      // ── Candle routes ──
      if (path === "/candles" && method === "GET") {
        return handleGetCandles(url, env);
      }
      if (path === "/candles" && method === "POST") {
        return handlePostCandles(request, env);
      }
      if (path === "/candles/range" && method === "GET") {
        return handleGetRange(url, env);
      }
      if (path === "/candles/count" && method === "GET") {
        return handleGetCount(url, env);
      }
      if (path === "/candles" && method === "DELETE") {
        return handleDeleteCandles(url, env);
      }

      // ── ML model routes (R2) — available when R2 is enabled ──
      if (path.startsWith("/models")) {
        if (!env.MODELS) return err("R2 not enabled — models stored in MongoDB Atlas", 501);
        if (path.startsWith("/models/") && method === "GET") return handleGetModel(path, env);
        if (path.startsWith("/models/") && method === "PUT") return handlePutModel(path, request, env);
        if (path === "/models" && method === "GET") return handleListModels(env);
        if (path.startsWith("/models/") && method === "DELETE") return handleDeleteModel(path, env);
      }


      return err("Not found", 404);
    } catch (e: any) {
      return err(e.message || "Internal error", 500);
    }
  },
};

// ── Candle handlers ──

async function handleGetCandles(url: URL, env: Env): Promise<Response> {
  const instrument = url.searchParams.get("instrument");
  const granularity = url.searchParams.get("granularity");
  if (!instrument || !granularity) {
    return err("instrument and granularity required");
  }

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const limit = parseInt(url.searchParams.get("limit") || "5000");
  const offset = parseInt(url.searchParams.get("offset") || "0");

  let query = "SELECT * FROM candles WHERE instrument = ? AND granularity = ?";
  const params: (string | number)[] = [instrument, granularity];

  if (from) {
    query += " AND timestamp >= ?";
    params.push(from);
  }
  if (to) {
    query += " AND timestamp <= ?";
    params.push(to);
  }

  query += " ORDER BY timestamp ASC LIMIT ? OFFSET ?";
  params.push(limit, offset);

  const result = await env.DB.prepare(query).bind(...params).all<CandleRow>();

  return json({
    instrument,
    granularity,
    count: result.results.length,
    candles: result.results,
  });
}

async function handlePostCandles(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as { candles: CandleRow[] };
  if (!body.candles || !Array.isArray(body.candles)) {
    return err("candles array required");
  }

  const candles = body.candles;
  let inserted = 0;

  // D1 batch limit: 25 statements per batch
  const BATCH_SIZE = 25;
  for (let i = 0; i < candles.length; i += BATCH_SIZE) {
    const batch = candles.slice(i, i + BATCH_SIZE);
    const stmts = batch.map((c) =>
      env.DB.prepare(
        `INSERT INTO candles (instrument, granularity, timestamp, open, high, low, close, volume)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (instrument, granularity, timestamp)
         DO UPDATE SET open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close, volume=excluded.volume`
      ).bind(c.instrument, c.granularity, c.timestamp, c.open, c.high, c.low, c.close, c.volume)
    );

    const results = await env.DB.batch(stmts);
    inserted += results.filter((r) => r.success).length;
  }

  return json({ inserted, total: candles.length });
}

async function handleGetRange(url: URL, env: Env): Promise<Response> {
  const instrument = url.searchParams.get("instrument");
  const granularity = url.searchParams.get("granularity");
  if (!instrument || !granularity) {
    return err("instrument and granularity required");
  }

  const result = await env.DB.prepare(
    `SELECT MIN(timestamp) as min_ts, MAX(timestamp) as max_ts, COUNT(*) as count
     FROM candles WHERE instrument = ? AND granularity = ?`
  ).bind(instrument, granularity).first<{ min_ts: string; max_ts: string; count: number }>();

  if (!result || result.count === 0) {
    return json(null);
  }

  return json({ from: result.min_ts, to: result.max_ts, count: result.count });
}

async function handleGetCount(url: URL, env: Env): Promise<Response> {
  const instrument = url.searchParams.get("instrument");
  const granularity = url.searchParams.get("granularity");

  let query = "SELECT instrument, granularity, COUNT(*) as count FROM candles";
  const params: string[] = [];
  const conditions: string[] = [];

  if (instrument) {
    conditions.push("instrument = ?");
    params.push(instrument);
  }
  if (granularity) {
    conditions.push("granularity = ?");
    params.push(granularity);
  }

  if (conditions.length) {
    query += " WHERE " + conditions.join(" AND ");
  }
  query += " GROUP BY instrument, granularity";

  const result = await env.DB.prepare(query).bind(...params).all();
  return json(result.results);
}

async function handleDeleteCandles(url: URL, env: Env): Promise<Response> {
  const instrument = url.searchParams.get("instrument");
  const granularity = url.searchParams.get("granularity");
  if (!instrument || !granularity) {
    return err("instrument and granularity required");
  }

  const result = await env.DB.prepare(
    "DELETE FROM candles WHERE instrument = ? AND granularity = ?"
  ).bind(instrument, granularity).run();

  return json({ deleted: result.meta.changes });
}

// ── ML model handlers (R2) ──

async function handleGetModel(path: string, env: Env): Promise<Response> {
  const name = path.replace("/models/", "");

  // Check for meta request
  if (name.endsWith("/meta")) {
    const modelName = name.replace("/meta", "");
    const metaObj = await env.MODELS.get(`${modelName}.meta.json`);
    if (!metaObj) return err("Model meta not found", 404);
    const meta = await metaObj.json();
    return json(meta);
  }

  const obj = await env.MODELS.get(`${name}.weights.h5`);
  if (!obj) return err("Model not found", 404);

  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": obj.size.toString(),
    },
  });
}

async function handlePutModel(path: string, request: Request, env: Env): Promise<Response> {
  const name = path.replace("/models/", "");

  // Check if this is a meta upload
  if (name.endsWith("/meta")) {
    const modelName = name.replace("/meta", "");
    const meta = await request.json();
    await env.MODELS.put(`${modelName}.meta.json`, JSON.stringify(meta));
    return json({ saved: `${modelName}.meta.json` });
  }

  const weights = await request.arrayBuffer();
  await env.MODELS.put(`${name}.weights.h5`, weights);
  return json({ saved: `${name}.weights.h5`, size: weights.byteLength });
}

async function handleListModels(env: Env): Promise<Response> {
  const list = await env.MODELS.list();
  const models = list.objects.map((o) => ({
    key: o.key,
    size: o.size,
    uploaded: o.uploaded.toISOString(),
  }));
  return json({ models });
}

async function handleDeleteModel(path: string, env: Env): Promise<Response> {
  const name = path.replace("/models/", "");
  await env.MODELS.delete(`${name}.weights.h5`);
  await env.MODELS.delete(`${name}.meta.json`);
  return json({ deleted: name });
}
