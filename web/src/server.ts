import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { join } from 'node:path';
import { proxyCors, proxyGuard, setSessionCookie } from './proxy-guard';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

/**
 * Same-origin proxy to the internal API.
 *
 * The interactive map needs to re-query as the user pans/zooms, which is
 * inherently a client-side action. To keep the API key and API URL OUT of the
 * browser, the browser only ever calls these same-origin endpoints; this server
 * injects the `x-api-key` header and forwards to the internal API. The real API
 * and its key are never exposed to the client.
 */
const API_BASE_URL = process.env['API_BASE_URL'] || 'http://127.0.0.1:3001';
const API_KEY = process.env['API_KEY'] || '';

/** Forwards a request to the internal API, injecting the API key server-side. */
async function proxyToApi(
  path: string,
  allowedParams: string[],
  req: express.Request,
  res: express.Response,
): Promise<void> {
  try {
    const target = new URL(path, API_BASE_URL);
    for (const key of allowedParams) {
      const value = req.query[key];
      if (typeof value === 'string' && value.length > 0) {
        target.searchParams.set(key, value);
      }
    }
    const upstream = await fetch(target, {
      headers: { Accept: 'application/json', 'x-api-key': API_KEY },
    });
    const body = await upstream.text();
    res
      .status(upstream.status)
      .type(upstream.headers.get('content-type') ?? 'application/json')
      .send(body);
  } catch (err) {
    console.error(`[web] proxy ${path} failed:`, err);
    res.status(502).json({ error: 'Upstream API request failed' });
  }
}

// Guard the proxy so only our own app can realistically use it:
//   (a) strict CORS, (b) origin/referer check, (c) per-IP rate limit,
//   (d) session-token cookie issued by the SSR page. See proxy-guard.ts.
app.use('/api', proxyCors(), proxyGuard());

// Bounding-box search for the current map viewport, with date range + limit.
app.get('/api/bbox', (req, res) =>
  proxyToApi(
    '/reports/bbox',
    ['minLat', 'maxLat', 'minLng', 'maxLng', 'from', 'to', 'limit'],
    req,
    res,
  ),
);

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application. Every rendered
 * page also (re)issues the session cookie that the /api/* proxy requires, so the
 * proxy can only be used from a real, freshly-rendered page session.
 */
app.use((req, res, next) => {
  setSessionCookie(res);
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
