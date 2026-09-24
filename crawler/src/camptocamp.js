import { optionalEnv } from '@alpica/db/env';
import { toMysqlDate } from './runner.js';

/**
 * Adapter for the Camptocamp (C2C) v6 API `/outings` endpoint.
 * Repo: https://github.com/c2corg/v6_api
 * API:  https://api.camptocamp.org/outings
 *
 * Notes about the live API (verified against the real endpoint):
 *  - List response: { documents: [...], total: N }. Paginated with limit/offset.
 *  - Default order is by activity date (date_start) DESCending — newest first.
 *  - List items carry title (per-language locales), date_start/date_end,
 *    activities[], author.name, areas[] (free-text place), and geometry.geom,
 *    which is a GeoJSON Point in EPSG:3857 (Web Mercator) — NOT lat/long.
 *  - No thumbnail URL on the list item; we build the outing URL from the id.
 *
 * Incremental strategy: page newest-first and stop as soon as an item's
 * date_start is older than the watermark. C2C has no reliable "updated since"
 * list filter, so we rely on the date ordering.
 */
export const SOURCE = 'camptocamp';

/** Language preference for picking a title/place from multilingual locales. */
const LANG_PREFERENCE = ['de', 'en', 'fr', 'it', 'es'];

function baseUrl() {
  return optionalEnv('CAMPTOCAMP_BASE_URL', 'https://api.camptocamp.org').replace(
    /\/+$/,
    ''
  );
}

function outingUrl(documentId) {
  const web = optionalEnv('CAMPTOCAMP_WEB_URL', 'https://www.camptocamp.org').replace(
    /\/+$/,
    ''
  );
  return `${web}/outings/${documentId}`;
}

/** Base URL of the C2C media (image) storage. */
function mediaBaseUrl() {
  return optionalEnv(
    'CAMPTOCAMP_MEDIA_URL',
    'https://media.camptocamp.org/c2corg-active'
  ).replace(/\/+$/, '');
}

/**
 * Builds a thumbnail URL for a C2C image `filename` at the given size.
 *
 * C2C stores resized variants next to the original by inserting a size suffix
 * before the extension (see c2corg/v6_images):
 *   - 'SI' = 200x200 square (best for list thumbnails)
 *   - 'MI' = 400px
 *   - 'BI' = 1500px
 * e.g. "1789828504_148445734.jpg" + "SI" -> ".../1789828504_148445734SI.jpg"
 *
 * @param {string} filename
 * @param {'SI'|'MI'|'BI'} [size]
 */
export function buildThumbnailUrl(filename, size = 'MI') {
  if (!filename || typeof filename !== 'string') return null;
  const dot = filename.lastIndexOf('.');
  const base = dot === -1 ? filename : filename.slice(0, dot);
  const ext = dot === -1 ? 'jpg' : filename.slice(dot + 1);
  return `${mediaBaseUrl()}/${base}${size}.${ext}`;
}

/** Sleep helper for backoff. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * GET JSON with retry + exponential backoff. The C2C API intermittently returns
 * 5xx / HTML error pages under load, so retries make the crawl resilient.
 */
async function getJson(path, params = {}, { retries = 4 } = {}) {
  const url = new URL(baseUrl() + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) {
      const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000);
      await sleep(backoff);
    }
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mountain-Radar/0.1 (+crawler)',
        },
      });

      if (!res.ok) {
        lastError = new Error(
          `Camptocamp GET ${url.pathname} failed: ${res.status} ${res.statusText}`
        );
        // 4xx (except 429) won't get better on retry.
        if (res.status >= 400 && res.status < 500 && res.status !== 429) {
          throw lastError;
        }
        continue;
      }

      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch {
        // Occasionally the API returns an HTML error page with a 200-ish status.
        lastError = new Error(
          `Camptocamp GET ${url.pathname} returned non-JSON (status ${res.status})`
        );
        continue;
      }
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error(`Camptocamp GET ${url.pathname} failed`);
}

/**
 * Async generator yielding outing documents newest-first, stopping once items
 * are older than `since` (the watermark). Also stops at a configurable safety
 * cap so an initial run doesn't page through the entire history.
 *
 * @param {Date|null} since
 */
export async function* iterateOutings(since) {
  const pageSize = Math.min(Number(optionalEnv('CRAWLER_PAGE_SIZE', '100')), 100);
  const maxItems = Number(optionalEnv('CAMPTOCAMP_MAX_ITEMS', '2000'));
  const sinceTime = since instanceof Date && !Number.isNaN(since.valueOf()) ? since.getTime() : null;

  let offset = 0;
  let yielded = 0;

  while (yielded < maxItems) {
    const data = await getJson('/outings', { limit: pageSize, offset });
    const docs = data?.documents ?? [];
    if (docs.length === 0) break;

    for (const doc of docs) {
      // Stop once we reach items at or before the watermark (newest-first order).
      const itemTime = parseDate(doc?.date_end || doc?.date_start);
      if (sinceTime !== null && itemTime !== null && itemTime <= sinceTime) {
        return;
      }
      yield doc;
      yielded += 1;
      if (yielded >= maxItems) return;
    }

    offset += docs.length;
    const total = data?.total ?? 0;
    if (offset >= total) break;
  }
}

/**
 * Fetches the first associated image filename for an outing via its detail
 * endpoint. Returns null if the outing has no images or the request fails.
 *
 * This is an extra request per outing, so callers should only invoke it for
 * outings whose `img_count > 0`.
 *
 * @param {number|string} documentId
 * @returns {Promise<string|null>}
 */
export async function fetchFirstImageFilename(documentId) {
  try {
    const detail = await getJson(`/outings/${documentId}`, {}, { retries: 2 });
    const images = detail?.associations?.images ?? [];
    for (const img of images) {
      if (img?.filename) return img.filename;
    }
  } catch {
    // A missing thumbnail is not worth failing the crawl over.
  }
  return null;
}

/**
 * Enriches an outing document (in place) with a `_thumbnail` URL by fetching the
 * outing detail, but only when thumbnails are enabled and the outing has images.
 * A short pause is applied to be gentle on the flaky C2C API.
 */
async function enrichThumbnail(doc) {
  if (!thumbnailsEnabled() || !(doc?.img_count > 0)) return;
  const filename = await fetchFirstImageFilename(doc.document_id);
  if (filename) {
    doc._thumbnail = buildThumbnailUrl(filename, thumbnailSize());
  }
  const delayMs = Number(optionalEnv('CAMPTOCAMP_DETAIL_DELAY_MS', '250'));
  if (delayMs > 0) await sleep(delayMs);
}

function thumbnailsEnabled() {
  return optionalEnv('CAMPTOCAMP_FETCH_THUMBNAILS', 'true') !== 'false';
}

function thumbnailSize() {
  const size = optionalEnv('CAMPTOCAMP_THUMBNAIL_SIZE', 'MI');
  return ['SI', 'MI', 'BI'].includes(size) ? size : 'MI';
}

/** Parses a C2C date (YYYY-MM-DD) into epoch ms, or null. */
function parseDate(value) {
  if (!value) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.valueOf()) ? null : d.getTime();
}

/**
 * Picks the best-language title from a list of locales.
 * @param {Array<{lang:string,title?:string}>} locales
 */
function pickLocaleTitle(locales) {
  if (!Array.isArray(locales) || locales.length === 0) return null;
  for (const lang of LANG_PREFERENCE) {
    const hit = locales.find((l) => l?.lang === lang && l?.title);
    if (hit) return hit.title;
  }
  return locales.find((l) => l?.title)?.title ?? null;
}

/**
 * Builds a free-text place from the outing's areas (most specific last), e.g.
 * "France, Hautes-Alpes, Écrins".
 */
function buildPlace(areas) {
  if (!Array.isArray(areas)) return null;
  const titles = areas
    .map((a) => pickLocaleTitle(a?.locales))
    .filter((t) => typeof t === 'string' && t.length > 0);
  return titles.length ? titles.join(', ') : null;
}

/**
 * Converts an EPSG:3857 (Web Mercator) coordinate to WGS84 lat/long.
 * @returns {{ latitude: number|null, longitude: number|null }}
 */
export function mercatorToWgs84(x, y) {
  if (typeof x !== 'number' || typeof y !== 'number' || Number.isNaN(x) || Number.isNaN(y)) {
    return { latitude: null, longitude: null };
  }
  const R = 6378137.0; // Web Mercator sphere radius (metres)
  const longitude = (x / R) * (180 / Math.PI);
  const latitude = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);
  return {
    latitude: round6(latitude),
    longitude: round6(longitude),
  };
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

/** Extracts WGS84 lat/long from an outing's geometry.geom GeoJSON string. */
function extractLatLng(geometry) {
  const geomStr = geometry?.geom;
  if (!geomStr) return { latitude: null, longitude: null };
  try {
    const geom = typeof geomStr === 'string' ? JSON.parse(geomStr) : geomStr;
    const coords = geom?.coordinates;
    if (Array.isArray(coords) && coords.length >= 2) {
      return mercatorToWgs84(Number(coords[0]), Number(coords[1]));
    }
  } catch {
    // ignore malformed geometry
  }
  return { latitude: null, longitude: null };
}

/**
 * Maps a C2C outing document into the normalized `reports` schema.
 */
export function normalize(doc) {
  const { latitude, longitude } = extractLatLng(doc?.geometry);
  const activities = Array.isArray(doc?.activities) ? doc.activities.join(', ') : null;

  return {
    source: SOURCE,
    source_id: String(doc.document_id),
    title: pickLocaleTitle(doc?.locales),
    report_date: toMysqlDate(isoFromDate(doc?.date_start || doc?.date_end)),
    latitude,
    longitude,
    place: buildPlace(doc?.areas),
    author: doc?.author?.name ?? null,
    // Thumbnail is resolved from the outing detail during iteration (list items
    // carry no image URL). See enrichThumbnail().
    thumbnail: doc?._thumbnail ?? null,
    activity: activities,
    url: outingUrl(doc.document_id),
  };
}

/** C2C dates are date-only; turn into an ISO datetime at UTC midnight. */
function isoFromDate(value) {
  if (!value) return null;
  return `${value}T00:00:00Z`;
}

/** ISO datetime used to advance the watermark (the outing's activity date). */
export function itemDate(doc) {
  const v = doc?.date_end || doc?.date_start;
  return v ? isoFromDate(v) : null;
}

/**
 * Wraps iterateOutings and enriches each yielded document with a thumbnail URL
 * (when enabled). Doing it here keeps the runner's normalize() synchronous while
 * still storing the resolved thumbnail in both raw + normalized rows.
 */
async function* iterateEnriched(since) {
  for await (const doc of iterateOutings(since)) {
    await enrichThumbnail(doc);
    yield doc;
  }
}

/**
 * Source adapter consumed by the generic crawl runner (see runner.js).
 */
export const camptocampAdapter = {
  source: SOURCE,
  iterate: (since) => iterateEnriched(since),
  rawId: (doc) => String(doc.document_id),
  itemDate: (doc) => itemDate(doc),
  normalize: (doc) => normalize(doc),
};
