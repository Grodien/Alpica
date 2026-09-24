import { getPool } from '@alpica/db';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_LOOKBACK_DAYS = 30;

const SELECT_COLUMNS = `
  id, source, source_id AS sourceId, title, report_date AS date,
  latitude, longitude, place, author, thumbnail, activity, url
`;

/**
 * Parses and clamps the shared query parameters (from, to, limit) that both
 * endpoints support.
 *
 * - `limit` defaults to DEFAULT_LIMIT, clamped to [1, MAX_LIMIT].
 * - date range defaults to the last DEFAULT_LOOKBACK_DAYS days when omitted.
 */
export function parseCommonParams(query) {
  const limit = clampLimit(query.limit);

  let from = parseDate(query.from);
  let to = parseDate(query.to);

  if (!from) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - DEFAULT_LOOKBACK_DAYS);
    from = d;
  }
  if (!to) {
    to = new Date();
  }

  return {
    limit,
    from: toMysql(from),
    to: toMysql(to),
  };
}

function clampLimit(raw) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

function parseDate(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.valueOf()) ? null : d;
}

function toMysql(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Freetext search across all text fields (title, place, author, activity).
 * Uses the FULLTEXT index when the term looks usable, otherwise falls back to
 * LIKE so short terms still work.
 */
export async function searchByText({ q, from, to, limit }) {
  const pool = getPool();
  const term = (q ?? '').trim();

  if (term.length === 0) {
    // No search term: just return the most recent reports in range.
    const [rows] = await pool.query(
      `SELECT ${SELECT_COLUMNS}
         FROM reports
        WHERE report_date BETWEEN :from AND :to
        ORDER BY report_date DESC
        LIMIT :limit`,
      { from, to, limit }
    );
    return rows;
  }

  const like = `%${term.replace(/[%_]/g, (m) => '\\' + m)}%`;
  const [rows] = await pool.query(
    `SELECT ${SELECT_COLUMNS}
       FROM reports
      WHERE report_date BETWEEN :from AND :to
        AND (
          MATCH (title, place, author, activity) AGAINST (:term IN BOOLEAN MODE)
          OR title LIKE :like
          OR place LIKE :like
          OR author LIKE :like
          OR activity LIKE :like
        )
      ORDER BY report_date DESC
      LIMIT :limit`,
    { from, to, limit, term: booleanTerm(term), like }
  );
  return rows;
}

/**
 * Turns a user term into a MySQL BOOLEAN-mode fulltext query with a trailing
 * wildcard on each token (e.g. "tief schnee" -> "+tief* +schnee*").
 */
function booleanTerm(term) {
  return term
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => '+' + t.replace(/[+\-><()~*"@]/g, '') + '*')
    .filter((t) => t.length > 2)
    .join(' ');
}

/**
 * Bounding-box search: all reports whose coordinates fall within
 * [minLat, maxLat] x [minLng, maxLng] and the date range.
 */
export async function searchByBoundingBox({ bbox, from, to, limit }) {
  const pool = getPool();
  const [rows] = await pool.query(
    `SELECT ${SELECT_COLUMNS}
       FROM reports
      WHERE report_date BETWEEN :from AND :to
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
        AND latitude BETWEEN :minLat AND :maxLat
        AND longitude BETWEEN :minLng AND :maxLng
      ORDER BY report_date DESC
      LIMIT :limit`,
    { ...bbox, from, to, limit }
  );
  return rows;
}

/**
 * Validates and normalizes the four bounding-box coordinates. Returns
 * { bbox } on success or { error } describing the first problem.
 */
export function parseBoundingBox(query) {
  const minLat = Number(query.minLat);
  const maxLat = Number(query.maxLat);
  const minLng = Number(query.minLng);
  const maxLng = Number(query.maxLng);

  const nums = { minLat, maxLat, minLng, maxLng };
  for (const [key, value] of Object.entries(nums)) {
    if (!Number.isFinite(value)) {
      return { error: `Query param "${key}" must be a number` };
    }
  }
  if (minLat < -90 || maxLat > 90 || minLat > maxLat) {
    return { error: 'Invalid latitude range (expected -90..90 and minLat <= maxLat)' };
  }
  if (minLng < -180 || maxLng > 180 || minLng > maxLng) {
    return { error: 'Invalid longitude range (expected -180..180 and minLng <= maxLng)' };
  }

  return { bbox: { minLat, maxLat, minLng, maxLng } };
}
