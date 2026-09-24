import { optionalEnv } from '@alpica/db/env';

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
  await pool.query(
    `INSERT INTO reports
       (source, source_id, title, report_date, latitude, longitude,
        place, author, thumbnail, activity, url)
     VALUES
       (:source, :source_id, :title, :report_date, :latitude, :longitude,
        :place, :author, :thumbnail, :activity, :url)
     ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        report_date = VALUES(report_date),
        latitude = VALUES(latitude),
        longitude = VALUES(longitude),
        place = VALUES(place),
        author = VALUES(author),
        thumbnail = VALUES(thumbnail),
        activity = VALUES(activity),
        url = VALUES(url)`,
    r
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
