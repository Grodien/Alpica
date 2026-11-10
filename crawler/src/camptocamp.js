import { optionalEnv } from '@alpica/db/env';
import { toMysqlDate, cleanDescription } from './runner.js';

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
export async function* iterateOutings(since, until) {
  const pageSize = Math.min(Number(optionalEnv('CRAWLER_PAGE_SIZE', '100')), 100);
  const maxItems = Number(optionalEnv('CAMPTOCAMP_MAX_ITEMS', '2000'));
  const sinceTime = since instanceof Date && !Number.isNaN(since.valueOf()) ? since.getTime() : null;
  const untilValid = until instanceof Date && !Number.isNaN(until.valueOf());
  const untilTime = untilValid ? until.getTime() : null;

  // When BOTH bounds are given (backfill), use C2C's server-side `date=from,to`
  // range filter so we only fetch that window. This is essential: the API
  // hard-caps `offset + limit <= 10000`, so paging newest-first from offset 0
  // down to an old month would 400 (there are hundreds of thousands of outings
  // newer than the window). The filter also makes it far faster — a month is
  // ~1-2k outings instead of everything-since-now. The `date` filter matches on
  // OVERLAP (multi-day outings spanning the window are included), so the caller
  // still assigns each outing to its month by the normalized report_date.
  const useDateFilter = sinceTime !== null && untilValid;
  let dateParam;
  if (useDateFilter) {
    // `until` is the EXCLUSIVE start of the next window; the API bound is
    // inclusive, so use the day before (until - 1 day).
    const toInclusive = new Date(until.getTime() - 86_400_000);
    dateParam = `${toYmd(since)},${toYmd(toInclusive)}`;
  }

  let offset = 0;
  let yielded = 0;

  while (yielded < maxItems) {
    const params = { limit: pageSize, offset };
    if (dateParam) params.date = dateParam;
    const data = await getJson('/outings', params);
    const docs = data?.documents ?? [];
    if (docs.length === 0) break;

    for (const doc of docs) {
      const itemTime = parseDate(doc?.date_end || doc?.date_start);
      // Without a server-side window (normal incremental crawl) we page
      // newest-first and stop at the watermark.
      if (!useDateFilter && sinceTime !== null && itemTime !== null && itemTime <= sinceTime) {
        return;
      }
      // Skip items outside the window (overlap matches can fall just outside);
      // don't count them against maxItems.
      if (untilTime !== null && itemTime !== null && itemTime > untilTime) {
        continue;
      }
      if (useDateFilter && sinceTime !== null && itemTime !== null && itemTime < sinceTime) {
        continue;
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
  const detail = await fetchOutingDetail(documentId);
  return firstImageFilename(detail);
}

/** Fetches the full outing document (detail endpoint). Returns null on failure. */
export async function fetchOutingDetail(documentId) {
  try {
    return await getJson(`/outings/${documentId}`, {}, { retries: 2 });
  } catch {
    // A failed detail fetch must not fail the crawl.
    return null;
  }
}

/** First associated image filename from a detail document, or null. */
function firstImageFilename(detail) {
  const images = detail?.associations?.images ?? [];
  for (const img of images) {
    if (img?.filename) return img.filename;
  }
  return null;
}

/**
 * Enriches an outing document (in place) with a `_thumbnail` URL by fetching the
 * outing detail, but only when thumbnails are enabled and the outing has images.
 * A short pause is applied to be gentle on the flaky C2C API.
 */
async function enrichDetail(doc) {
  // The per-outing detail request is the single biggest cost of a C2C crawl
  // (one HTTP round-trip + a politeness delay per outing). For a large
  // historical backfill you can disable it with CAMPTOCAMP_FETCH_DETAIL=false
  // to trade the long-form description + thumbnail for a MUCH faster run; the
  // list item still carries title, date, place, coords, and a short summary.
  if (!detailEnabled()) {
    doc._description = pickLocaleSummary(doc?.locales);
    return;
  }

  // One detail request per outing provides BOTH the full-text description and
  // (when present) the first image filename for a thumbnail.
  const detail = await fetchOutingDetail(doc.document_id);
  if (detail) {
    doc._description = pickLocaleField(detail?.locales, 'description');
    if (thumbnailsEnabled() && doc?.img_count > 0) {
      const filename = firstImageFilename(detail);
      if (filename) doc._thumbnail = buildThumbnailUrl(filename, thumbnailSize());
    }
  }
  // Only pause after an actual request (skipped entirely when detail is off).
  const delayMs = Number(optionalEnv('CAMPTOCAMP_DETAIL_DELAY_MS', '250'));
  if (delayMs > 0) await sleep(delayMs);
}

/** Whether to fetch per-outing detail (description + thumbnail). */
function detailEnabled() {
  return optionalEnv('CAMPTOCAMP_FETCH_DETAIL', 'true') !== 'false';
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
 * Picks the best-language value of a locale field (e.g. description,
 * conditions). Returns null when no locale carries it.
 */
function pickLocaleField(locales, field) {
  if (!Array.isArray(locales) || locales.length === 0) return null;
  for (const lang of LANG_PREFERENCE) {
    const hit = locales.find((l) => l?.lang === lang && l?.[field]);
    if (hit) return hit[field];
  }
  return locales.find((l) => l?.[field])?.[field] ?? null;
}

/**
 * Picks the best-language summary from a list of locales (may be null).
 * @param {Array<{lang:string,summary?:string}>} locales
 */
function pickLocaleSummary(locales) {
  if (!Array.isArray(locales) || locales.length === 0) return null;
  for (const lang of LANG_PREFERENCE) {
    const hit = locales.find((l) => l?.lang === lang && l?.summary);
    if (hit) return hit.summary;
  }
  return locales.find((l) => l?.summary)?.summary ?? null;
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
    // Full-text description comes from the detail endpoint (see enrichDetail);
    // fall back to the (usually empty) list summary. null -> UI uses place.
    description: cleanDescription(doc?._description ?? pickLocaleSummary(doc?.locales)),
    author: doc?.author?.name ?? null,
    // Thumbnail is resolved from the outing detail during iteration (list items
    // carry no image URL). See enrichThumbnail().
    thumbnail: doc?._thumbnail ?? null,
    activity: activities,
    url: outingUrl(doc.document_id),
  };
}

/** Formats a Date as a UTC "YYYY-MM-DD" string for the C2C `date` filter. */
function toYmd(d) {
  return d.toISOString().slice(0, 10);
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
async function* iterateEnriched(since, until) {
  for await (const doc of iterateOutings(since, until)) {
    await enrichDetail(doc);
    yield doc;
  }
}

/**
 * Source adapter consumed by the generic crawl runner (see runner.js).
 */
export const camptocampAdapter = {
  source: SOURCE,
  // `until` (optional) bounds the upper end for the backfill's monthly windows.
  iterate: (since, until) => iterateEnriched(since, until),
  rawId: (doc) => String(doc.document_id),
  itemDate: (doc) => itemDate(doc),
  normalize: (doc) => normalize(doc),
};
