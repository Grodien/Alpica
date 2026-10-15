import { optionalEnv, requireEnv } from '@alpica/db/env';
import { toMysqlDate } from './runner.js';

/**
 * Adapter for the Gipfelbuch.ch V2 API `/api/v2/conditions` endpoint.
 * Docs: provided PDF (V2 - API Documentation, Oct 2026).
 *
 * Notes about the API (verified against the live endpoint):
 *  - Auth: the API key MUST be passed as the `api_key` query parameter. The
 *    documented `X-API-KEY` header returned 403 on this installation.
 *  - `/conditions` can be called with ONLY date_from/date_to (no coordinates);
 *    it then returns conditions from everywhere, which is exactly what a crawl
 *    needs. `limit` is a hard cap, and there is no pagination, so we set a high
 *    limit covering the date window.
 *  - Response: { conditions: [...], search_parameters: {...} }.
 *  - Each condition carries uuid, id, activity, activity_date, title, route,
 *    spot {title, latitude, longitude, distance}, url, created_at, image,
 *    author, region. Dates are in Europe/Zurich.
 *
 * Crawl strategy: a single date-windowed request (watermark..now). The
 * watermark stays date-based (consistent with the other adapters).
 */
export const SOURCE = 'gipfelbuch';

function baseUrl() {
  return optionalEnv('GIPFELBUCH_BASE_URL', 'https://www.gipfelbuch.ch').replace(/\/+$/, '');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET JSON with retry + backoff. Auth key goes in the `api_key` query param.
 */
async function getJson(path, params = {}, { retries = 4 } = {}) {
  const url = new URL(baseUrl() + path);
  url.searchParams.set('api_key', requireEnv('GIPFELBUCH_API_KEY'));
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mountain-Radar/0.1 (+crawler)' },
      });
      if (!res.ok) {
        lastError = new Error(`Gipfelbuch GET ${path} failed: ${res.status} ${res.statusText}`);
        if (res.status >= 400 && res.status < 500 && res.status !== 429) throw lastError;
        continue;
      }
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        lastError = new Error(`Gipfelbuch GET ${path} returned non-JSON`);
        continue;
      }
      if (data && data.status === 'error') {
        throw new Error(`Gipfelbuch API error: ${data.message ?? 'unknown'}`);
      }
      return data;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error(`Gipfelbuch GET ${path} failed`);
}

/** Formats a Date as Y-m-d (the format the API expects for date_from/date_to). */
function toYmd(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Async generator yielding conditions in the date window `since`..now via a
 * single request (no coordinates needed). `limit` is a hard server-side cap, so
 * it's set high enough to cover the window.
 *
 * @param {Date|null} since
 */
export async function* iterateConditions(since) {
  const limit = Number(optionalEnv('GIPFELBUCH_LIMIT', '2000'));
  const dateFrom = since instanceof Date && !Number.isNaN(since.valueOf()) ? toYmd(since) : undefined;
  const dateTo = toYmd(new Date());

  const data = await getJson('/api/v2/conditions', {
    limit,
    date_from: dateFrom,
    date_to: dateTo,
  });

  const conditions = data?.conditions ?? [];
  if (conditions.length >= limit) {
    // The result hit the hard cap — some conditions in the window were dropped.
    console.warn(
      `[gipfelbuch] result reached the limit of ${limit}; raise GIPFELBUCH_LIMIT to avoid gaps`
    );
  }
  for (const cond of conditions) {
    yield cond;
  }
}

/** Builds a free-text place from the spot title and region. */
function buildPlace(cond) {
  const parts = [];
  if (cond?.spot?.title) parts.push(cond.spot.title);
  if (cond?.region && cond.region !== cond?.spot?.title) parts.push(cond.region);
  return parts.length ? parts.join(', ') : null;
}

/**
 * Conditions are day-granular. The API returns activity_date as an ISO string
 * already anchored to the local (Europe/Zurich) day, e.g.
 * "2026-10-14T00:00:00+02:00". We keep that calendar day and store it at
 * 00:00:00, rather than converting to UTC (which would shift midnight back to
 * 22:00 on the previous day). Falls back to created_at if no activity_date.
 */
function reportDate(cond) {
  const activity = cond?.activity_date;
  if (typeof activity === 'string' && /^\d{4}-\d{2}-\d{2}/.test(activity)) {
    return `${activity.slice(0, 10)} 00:00:00`;
  }
  // created_at has a real time-of-day; keep it (converted to UTC) as a fallback.
  return toMysqlDate(cond?.created_at ?? null);
}

/** Maps a Gipfelbuch condition into the normalized `reports` schema. */
export function normalize(cond) {
  return {
    source: SOURCE,
    source_id: String(cond.id ?? cond.uuid),
    title: cond?.title ?? null,
    report_date: reportDate(cond),
    latitude: cond?.spot?.latitude ?? null,
    longitude: cond?.spot?.longitude ?? null,
    place: buildPlace(cond),
    author: cond?.author ?? null,
    thumbnail: cond?.image ?? null,
    activity: cond?.activity ?? null,
    url: cond?.url ?? null,
  };
}

/** ISO datetime used to advance the watermark (the condition's activity date). */
export function itemDate(cond) {
  return cond?.activity_date ?? cond?.created_at ?? null;
}

/**
 * Source adapter consumed by the generic crawl runner (see runner.js).
 */
export const gipfelbuchAdapter = {
  source: SOURCE,
  iterate: (since) => iterateConditions(since),
  rawId: (cond) => String(cond.id ?? cond.uuid),
  itemDate: (cond) => itemDate(cond),
  normalize: (cond) => normalize(cond),
};
