import cors from 'cors';
import express from 'express';
import { closePool, getPool } from '@alpica/db';
import { optionalEnv } from '@alpica/db/env';
import { apiKeyAuth } from './auth.js';
import {
  parseBoundingBox,
  parseCommonParams,
  searchByBoundingBox,
  searchByText,
} from './reports.js';

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: optionalEnv('API_CORS_ORIGIN', '*') }));

// --- Public health check (no auth) ----------------------------------------
app.get('/health', async (_req, res) => {
  try {
    await getPool().query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'degraded', error: err.message });
  }
});

// --- Everything below requires a valid API key -----------------------------
app.use(apiKeyAuth());

/**
 * GET /reports/search
 * Freetext search across all text fields.
 *
 * Query params:
 *   q     - free text (optional; empty returns most recent in range)
 *   from  - ISO date-time (optional; defaults to 30 days ago)
 *   to    - ISO date-time (optional; defaults to now)
 *   limit - max results (optional; defaults to 50, max 200)
 */
app.get('/reports/search', async (req, res, next) => {
  try {
    const common = parseCommonParams(req.query);
    const results = await searchByText({ q: req.query.q, ...common });
    res.json({
      query: { q: req.query.q ?? null, from: common.from, to: common.to, limit: common.limit },
      count: results.length,
      results,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /reports/bbox
 * Bounding-box search by coordinates.
 *
 * Query params:
 *   minLat, maxLat, minLng, maxLng - required bounding box (degrees)
 *   from, to, limit                - same as /reports/search
 */
app.get('/reports/bbox', async (req, res, next) => {
  try {
    const box = parseBoundingBox(req.query);
    if (box.error) {
      return res.status(400).json({ error: box.error });
    }
    const common = parseCommonParams(req.query);
    const results = await searchByBoundingBox({ bbox: box.bbox, ...common });
    res.json({
      query: { bbox: box.bbox, from: common.from, to: common.to, limit: common.limit },
      count: results.length,
      results,
    });
  } catch (err) {
    next(err);
  }
});

// --- Fallbacks --------------------------------------------------------------
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Centralized error handler.
app.use((err, _req, res, _next) => {
  console.error('[api] error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = Number(optionalEnv('API_PORT', '3001'));
// Bind to the loopback interface by default so the API is NOT reachable from
// outside the host. Only the co-located web SSR server (same machine) talks to
// it. Set API_HOST=0.0.0.0 explicitly if you ever need to expose it.
const host = optionalEnv('API_HOST', '127.0.0.1');
const server = app.listen(port, host, () => {
  console.log(`[api] listening on http://${host}:${port} (loopback only)`);
});

// Graceful shutdown so the DB pool is released.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`[api] ${signal} received, shutting down`);
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
  });
}
