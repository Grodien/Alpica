import { optionalEnv, requireEnv } from '@alpica/db/env';

/**
 * Adapter for the skitour.fr API `/sorties` endpoint (ski-touring outings).
 * Docs: https://skitour.fr/api/
 *
 * Notes about the API (verified against the live endpoint):
 *  - Auth is a custom header `cle: <API key>` (SKITOUR_API_KEY).
 *  - `/sorties` returns a JSON array, sorted by date DESC (newest first).
 *  - With `c=1` each item includes details in the feed: `sommets[]` and
 *    `depart` (both carry real WGS84 lat/lng), and `photos[]` (direct URLs).
 *    So no per-item detail request is needed.
 *  - `date` is a Unix timestamp (seconds). `id` is a numeric string.
 *  - Filters: `j` = last N days, `f` = only ids greater than the given one,
 *    `l` = page size (max 1000), `p` = page number.
 *  - Rate limits: 1000 req / 24h and 60 / minute.
 *
 * Incremental strategy: page newest-first and stop as soon as an item's date is
 * older than the watermark (consistent with the other adapters, which key the
 * shared crawler_state on a datetime). On the first run we pass `j` so the
 * server only returns the recent window.
 */
export const SOURCE = 'skitour';

/** All ski-touring outings; there is no per-item activity field. */
const ACTIVITY = 'skitour';

function baseUrl() {
  return optionalEnv('SKITOUR_BASE_URL', 'https://skitour.fr/api').replace(/\/+$/, '');
}

function webBaseUrl() {
  return optionalEnv('SKITOUR_WEB_URL', 'https://skitour.fr').replace(/\/+$/, '');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET JSON with the `cle` auth header, retry + backoff. Returns the parsed body.
 */
async function getJson(path, params = {}, { retries = 4 } = {}) {
  const url = new URL(baseUrl() + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  const key = requireEnv('SKITOUR_API_KEY');

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          cle: key,
          'User-Agent': 'Mountain-Radar/0.1 (+crawler)',
        },
      });
      if (!res.ok) {
        lastError = new Error(
          `Skitour GET ${url.pathname} failed: ${res.status} ${res.statusText}`
        );
        if (res.status >= 400 && res.status < 500 && res.status !== 429) throw lastError;
        continue;
      }
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        lastError = new Error(`Skitour GET ${url.pathname} returned non-JSON`);
        continue;
      }
      if (data && !Array.isArray(data) && data.ERROR) {
        throw new Error(`Skitour API error: ${data.ERROR}`);
      }
      return data;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error(`Skitour GET ${url.pathname} failed`);
}

/**
 * Async generator yielding sorties newest-first, stopping once items are older
 * than `since`. Uses `c=1` so each item carries coordinates and photos.
 *
 * @param {Date|null} since
 */
export async function* iterateSorties(since) {
  const pageSize = Math.min(Number(optionalEnv('CRAWLER_PAGE_SIZE', '100')), 1000);
  const maxItems = Number(optionalEnv('SKITOUR_MAX_ITEMS', '2000'));
  const sinceTime = since instanceof Date && !Number.isNaN(since.valueOf()) ? since.getTime() : null;

  // On an initial/bounded run, ask the server for a recent window to avoid
  // paging through the whole history.
  const params = { c: 1, l: pageSize };
  if (sinceTime !== null) {
    const days = Math.ceil((Date.now() - sinceTime) / 86400000) + 1;
    // Only apply the day filter for reasonable windows; otherwise page freely.
    if (days > 0 && days <= 366) params.j = days;
  }

  let page = 1;
  let yielded = 0;

  while (yielded < maxItems) {
    const items = await getJson('/sorties', { ...params, p: page });
    if (!Array.isArray(items) || items.length === 0) break;

    for (const item of items) {
      const itemTime = parseTimestamp(item?.date);
      if (sinceTime !== null && itemTime !== null && itemTime <= sinceTime) {
        return;
      }
      yield item;
      yielded += 1;
      if (yielded >= maxItems) return;
    }

    if (items.length < pageSize) break; // last page
    page += 1;
  }
}

/** Parses a Unix timestamp (seconds, as string or number) into epoch ms. */
function parseTimestamp(value) {
  if (value === undefined || value === null || value === '') return null;
  const secs = Number(value);
  if (!Number.isFinite(secs)) return null;
  return secs * 1000;
}

/** ISO datetime (UTC) from a Unix timestamp (seconds). Used for the watermark. */
function isoFromTimestamp(value) {
  const ms = parseTimestamp(value);
  return ms === null ? null : new Date(ms).toISOString();
}

/**
 * Timezone the skitour.fr timestamps are anchored to. Outings are day-granular
 * events; the API encodes the day as midnight in this zone, so we must read the
 * calendar day in this zone rather than in UTC (otherwise midnight Paris time
 * becomes 22:00 UTC on the *previous* day).
 */
const SOURCE_TIMEZONE = optionalEnv('SKITOUR_TIMEZONE', 'Europe/Paris');

const dayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SOURCE_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Returns the calendar day (in the source timezone) of a Unix timestamp as a
 * MySQL DATETIME string at 00:00:00, e.g. "2026-09-18 00:00:00".
 *
 * skitour outings have no meaningful time-of-day, so we normalize to the day
 * boundary. This matches what skitour.fr displays.
 */
function reportDateFromTimestamp(value) {
  const ms = parseTimestamp(value);
  if (ms === null) return null;
  // en-CA formats as YYYY-MM-DD.
  const day = dayFormatter.format(new Date(ms));
  return `${day} 00:00:00`;
}

/**
 * Picks the outing's location: prefer the first summit, fall back to the
 * departure point. Both carry WGS84 lat/lng in the API.
 */
function extractLatLng(item) {
  const summit = Array.isArray(item?.sommets) ? item.sommets[0] : null;
  const point = summit ?? item?.depart ?? null;
  const lat = point ? Number(point.lat) : NaN;
  const lng = point ? Number(point.lng) : NaN;
  return {
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lng) ? lng : null,
  };
}

/** Builds a free-text place from the massif and the departure/summit name. */
function buildPlace(item) {
  const parts = [];
  const massif = item?.massif?.nom;
  if (massif) parts.push(massif);
  const summit = Array.isArray(item?.sommets) ? item.sommets[0]?.sommet : null;
  const depart = item?.depart?.depart;
  const spot = summit ?? depart;
  if (spot && spot !== massif) parts.push(spot);
  return parts.length ? parts.join(', ') : null;
}

/** First photo URL, if any. */
function firstPhoto(item) {
  const photos = item?.photos;
  if (Array.isArray(photos) && photos[0]?.url) return photos[0].url;
  return null;
}

/**
 * Maps a skitour sortie into the normalized `reports` schema.
 */
export function normalize(item) {
  const { latitude, longitude } = extractLatLng(item);
  return {
    source: SOURCE,
    source_id: String(item.id),
    title: item?.titre ?? null,
    // Day-granular date in the source timezone (see reportDateFromTimestamp).
    report_date: reportDateFromTimestamp(item?.date),
    latitude,
    longitude,
    place: buildPlace(item),
    author: item?.auteur?.pseudo ?? null,
    thumbnail: firstPhoto(item),
    activity: ACTIVITY,
    url: `${webBaseUrl()}/sorties/${item.id}`,
  };
}

/** ISO datetime used to advance the watermark. */
export function itemDate(item) {
  return isoFromTimestamp(item?.date);
}

/**
 * Source adapter consumed by the generic crawl runner (see runner.js).
 */
export const skitourAdapter = {
  source: SOURCE,
  iterate: (since) => iterateSorties(since),
  rawId: (item) => String(item.id),
  itemDate: (item) => itemDate(item),
  normalize: (item) => normalize(item),
};
