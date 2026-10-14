import { optionalEnv } from '@alpica/db/env';

/**
 * Adapter for the PowderGuide Conditions Report API (v2).
 * Spec: https://powderguide.com/api/v2/openapi
 *
 * Strategy for incremental crawling:
 *  - Use `/conditions_report` with `newer_than` = last watermark, paged.
 *  - The list items carry everything we need for the normalized schema EXCEPT
 *    spot coordinates, so we first load `/conditions_report/meta` once and build
 *    a spot uuid -> {latitude, longitude} lookup.
 */
export const SOURCE = 'powderguide';

function baseUrl() {
  return optionalEnv('POWDERGUIDE_BASE_URL', 'https://powderguide.com').replace(
    /\/+$/,
    ''
  );
}

async function getJson(path, params = {}) {
  const url = new URL(baseUrl() + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'de',
      'User-Agent': 'Alpica/0.1 (+crawler)',
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `PowderGuide GET ${url.pathname} failed: ${res.status} ${res.statusText} ${body.slice(0, 200)}`
    );
  }
  return res.json();
}

/**
 * Builds a Map of spot uuid -> { latitude, longitude, title, country } from the
 * meta endpoint. Coordinates are not present on list items, so this fills them.
 */
export async function fetchSpotLocationMap() {
  const meta = await getJson('/api/v2/conditions_report/meta');
  const map = new Map();
  for (const spot of meta?.spots ?? []) {
    const loc = spot?.location ?? {};
    // NOTE: the live API returns `lat`/`long` here, even though the published
    // OpenAPI spec documents `latitude`/`longitude`. Accept both.
    const latitude = loc.lat ?? loc.latitude ?? null;
    const longitude = loc.long ?? loc.lng ?? loc.longitude ?? null;
    map.set(spot.uuid, {
      latitude,
      longitude,
      title: spot?.title ?? null,
      country: spot?.country ?? null,
    });
  }
  return map;
}

/**
 * Async generator that yields conditions-report list items updated after
 * `newerThan` (a Date), oldest-first so the watermark advances monotonically.
 *
 * @param {Date|null} newerThan
 */
export async function* iterateReports(newerThan) {
  const perPage = Number(optionalEnv('CRAWLER_PAGE_SIZE', '100'));
  let page = 1;

  // Oldest-first by updated_at so we can advance the watermark safely and stop
  // early on the next run.
  const baseParams = {
    per_page: perPage,
    order_by: 'updated_at',
    order_direction: 'ASC',
  };
  if (newerThan instanceof Date && !Number.isNaN(newerThan.valueOf())) {
    baseParams.newer_than = newerThan.toISOString();
  }

  while (true) {
    const data = await getJson('/api/v2/conditions_report', {
      ...baseParams,
      page,
    });
    const items = data?.conditions_reports ?? [];
    for (const item of items) {
      yield item;
    }

    const pagination = data?.pagination;
    const nextPage = pagination?.next_page ?? null;
    if (!nextPage || items.length === 0) break;
    page = nextPage;
  }
}

/**
 * Maps a PowderGuide list item into the normalized `reports` schema.
 *
 * @param {object} item  a ConditionsReportListItem
 * @param {Map} spotMap  spot uuid -> location info
 */
export function normalize(item, spotMap) {
  const spotInfo = item?.spot?.uuid ? spotMap.get(item.spot.uuid) : null;

  const thumbnail =
    item?.media_thumbnails?.list_landscape ||
    item?.media_thumbnails?.list_portrait ||
    item?.media_thumbnails?.square ||
    item?.media ||
    null;

  const url = item?.urls?.source || item?.urls?.current || null;

  // "place" is free text describing the location — use the spot title.
  const place = item?.spot?.title ?? spotInfo?.title ?? null;

  return {
    source: SOURCE,
    source_id: item.uuid,
    // Title = the subline per requirements.
    title: item?.subline ?? item?.title ?? null,
    report_date: toMysqlDate(item?.activity_date ?? item?.created_at ?? null),
    latitude: spotInfo?.latitude ?? null,
    longitude: spotInfo?.longitude ?? null,
    place,
    author: item?.author?.name ?? item?.author?.username ?? null,
    thumbnail,
    activity: item?.activity ?? null,
    url,
  };
}

/**
 * Returns the most recent updated_at from a batch (ISO string) so the caller can
 * advance the watermark.
 */
export function itemUpdatedAt(item) {
  return item?.updated_at ?? item?.created_at ?? null;
}

/**
 * Converts an ISO date-time string into a MySQL DATETIME (UTC) string.
 */
export function toMysqlDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}
