import { optionalEnv } from '@alpica/db/env';
import { categorize } from './categories.js';

/**
 * Generic crawl runner shared by all source adapters.
 *
 * A source adapter is an object with:
 *   - source:            string, the value stored in the `source` column
 *   - init?(ctx):        optional async setup, may return a context object that
 *                        is passed to normalize() (e.g. a lookup map)
 *   - iterate(since):    async generator yielding raw source items, newest-last
 *                        or newest-first (order doesn't matter — the runner
 *                        tracks the max item date for the next watermark)
 *   - rawId(item):       string, unique id of the item within the source
 *   - itemDate(item):    ISO string used for the watermark (the item's "as of"
 *                        time), or null
 *   - normalize(item, context): returns a normalized `reports` row
 *
 * The runner reads the watermark, streams items, upserts raw + normalized rows,
 * advances the watermark to the newest item seen, and records run status.
 */
export async function runCrawl(pool, adapter) {
  const { source } = adapter;

  const since = await getWatermark(pool, source);
  console.log(
    `[${source}] starting crawl. watermark = ${since ? since.toISOString() : '(none — initial run)'}`
  );

  const context = adapter.init ? await adapter.init() : undefined;

  let processed = 0;
  let maxDate = since ? since.toISOString() : null;

  try {
    for await (const item of adapter.iterate(since)) {
      await upsertRaw(pool, source, adapter.rawId(item), item);
      await upsertNormalized(pool, adapter.normalize(item, context));
      processed += 1;

      const itemDate = adapter.itemDate(item);
      if (itemDate && (!maxDate || itemDate > maxDate)) {
        maxDate = itemDate;
      }

      if (processed % 100 === 0) {
        console.log(`[${source}] processed ${processed}...`);
      }
    }

    await recordSuccess(pool, source, maxDate);
    console.log(
      `[${source}] done. processed ${processed} report(s). new watermark = ${maxDate ?? '(unchanged)'}`
    );
    return { processed, watermark: maxDate };
  } catch (err) {
    await recordFailure(pool, source, err);
    throw err;
  }
}

/**
 * Reads the last watermark for a source. On the first run (no state) falls back
 * to CRAWLER_INITIAL_LOOKBACK_DAYS before now.
 */
async function getWatermark(pool, source) {
  const [rows] = await pool.query(
    'SELECT last_fetched_at FROM crawler_state WHERE source = ?',
    [source]
  );
  if (rows.length && rows[0].last_fetched_at) {
    return new Date(rows[0].last_fetched_at + 'Z');
  }
  const lookbackDays = Number(optionalEnv('CRAWLER_INITIAL_LOOKBACK_DAYS', '30'));
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - lookbackDays);
  return d;
}

async function upsertRaw(pool, source, sourceId, item) {
  await pool.query(
    `INSERT INTO raw_reports (source, source_id, payload)
     VALUES (?, ?, CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE payload = VALUES(payload)`,
    [source, sourceId, JSON.stringify(item)]
  );
}

async function upsertNormalized(pool, r) {
  // Derive the single normalized category from the raw activity token list.
  const row = { description: null, ...r, category: categorize(r.activity) };
  await pool.query(
    `INSERT INTO reports
       (source, source_id, title, report_date, latitude, longitude,
        place, description, author, thumbnail, activity, category, url)
     VALUES
       (:source, :source_id, :title, :report_date, :latitude, :longitude,
        :place, :description, :author, :thumbnail, :activity, :category, :url)
     ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        report_date = VALUES(report_date),
        latitude = VALUES(latitude),
        longitude = VALUES(longitude),
        place = VALUES(place),
        description = VALUES(description),
        author = VALUES(author),
        thumbnail = VALUES(thumbnail),
        activity = VALUES(activity),
        category = VALUES(category),
        url = VALUES(url)`,
    row
  );
}

async function recordSuccess(pool, source, maxDate) {
  const watermark = toMysqlDate(maxDate);
  await pool.query(
    `INSERT INTO crawler_state (source, last_fetched_at, last_run_at, last_status, last_error)
     VALUES (:source, :watermark, NOW(), 'success', NULL)
     ON DUPLICATE KEY UPDATE
        last_fetched_at = COALESCE(VALUES(last_fetched_at), last_fetched_at),
        last_run_at = NOW(),
        last_status = 'success',
        last_error = NULL`,
    { source, watermark }
  );
}

async function recordFailure(pool, source, err) {
  await pool.query(
    `INSERT INTO crawler_state (source, last_run_at, last_status, last_error)
     VALUES (:source, NOW(), 'error', :error)
     ON DUPLICATE KEY UPDATE
        last_run_at = NOW(),
        last_status = 'error',
        last_error = :error`,
    { source, error: String(err?.message ?? err).slice(0, 1000) }
  );
}

/** Converts an ISO date-time string into a MySQL DATETIME (UTC) string. */
export function toMysqlDate(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}


/**
 * Cleans a source description into short plain text: strips HTML tags, decodes
 * a few common entities, collapses whitespace, and truncates to `maxLen` chars
 * (on a word boundary, with an ellipsis). Returns null for empty input.
 */
export function cleanDescription(raw, maxLen = 300) {
  if (raw == null) return null;
  let t = String(raw);
  // HTML
  t = t.replace(/<br\s*\/?>/gi, ' ');      // line breaks -> space
  t = t.replace(/<[^>]+>/g, ' ');            // strip remaining tags
  t = t
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  // Markdown (camptocamp descriptions use it): links, headings, bullets, emphasis.
  t = t.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1'); // [text](url)/image -> text
  t = t.replace(/^#{1,6}\s+/gm, '');                   // ### headings
  t = t.replace(/^[\s>]*[-*+]\s+/gm, '');              // - / * bullets, blockquotes
  t = t.replace(/[*_`~]+/g, '');                        // leftover **bold**/_em_/`code`
  t = t.replace(/\s+/g, ' ').trim();
  if (t.length === 0) return null;
  if (t.length <= maxLen) return t;
  const cut = t.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}
