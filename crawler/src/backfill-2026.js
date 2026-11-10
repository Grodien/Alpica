/**
 * ONE-TIME BACKFILL SCRIPT — historical crawl in monthly batches.
 *
 * Why this exists
 * ---------------
 * The normal crawler only fetches the delta since each source's watermark
 * (`crawler_state.last_fetched_at`). On prod the data currently starts at
 * 2026-09-13; we want everything back to 2026-01-01.
 *
 * This script does NOT touch the watermark (`crawler_state`) at all. Instead it
 * drives each source adapter directly, one calendar-month window at a time, and
 * performs the SAME idempotent raw + normalized upserts the scheduled crawler
 * uses (`upsertRaw` / `upsertNormalized`, imported from runner.js). Advantages:
 *
 *   - No mutation of crawler_state, so the next scheduled incremental crawl is
 *     completely unaffected (its watermark stays exactly where it was).
 *   - Monthly batching keeps each request window small, so the per-source
 *     result caps (CAMPTOCAMP_MAX_ITEMS / SKITOUR_MAX_ITEMS / GIPFELBUCH_LIMIT)
 *     are not hit — a single month is well under those limits.
 *
 * How windowing works
 * -------------------
 * Every adapter's `iterate(since)` fetches from `since` FORWARD up to "now"
 * (there is no upper-bound parameter). To get a single month we call
 * `iterate(windowStart)` and then client-side keep only items whose
 * `adapter.itemDate(item)` falls inside `[windowStart, windowEnd)`. Items newer
 * than the window are skipped (they belong to a later window). Because we page
 * newest-first on some sources and oldest-first on others, we do NOT break
 * early — we just filter; a month is small enough that this is cheap.
 *
 * Idempotency / safety
 * --------------------
 * Both upserts key on each source's natural id (uq_raw_source /
 * uq_reports_source), so this is SAFE TO RE-RUN and never creates duplicates or
 * deletes anything. If a month fails, re-running the script (or just that
 * source) simply re-upserts.
 *
 * Usage
 * -----
 *   # from the repo root (reads the root .env):
 *   node crawler/src/backfill-2026.js --confirm                 # all sources
 *   node crawler/src/backfill-2026.js --confirm gipfelbuch      # one source
 *   node crawler/src/backfill-2026.js --confirm skitour powderguide
 *
 *   # custom window (ISO dates / bare YYYY-MM-DD, interpreted as UTC):
 *   BACKFILL_START=2026-01-01 BACKFILL_END=2026-09-13 \
 *     node crawler/src/backfill-2026.js --confirm
 *
 *   # pause between months (ms) to be gentle on flaky/rate-limited APIs:
 *   BACKFILL_MONTH_DELAY_MS=2000 node crawler/src/backfill-2026.js --confirm
 *
 *   # preview the plan without touching the DB or hitting any API:
 *   node crawler/src/backfill-2026.js --dry-run
 *
 * The --confirm flag is REQUIRED for a real run (this writes to prod). Without
 * --confirm (or with --dry-run) the script only prints the plan and exits.
 */

import { closePool, getPool } from '@alpica/db';
import { upsertRaw, upsertNormalized } from './runner.js';
import { powderguideAdapter } from './powderguide.js';
import { camptocampAdapter } from './camptocamp.js';
import { skitourAdapter } from './skitour.js';
import { gipfelbuchAdapter } from './gipfelbuch.js';

const ADAPTERS = {
  [powderguideAdapter.source]: powderguideAdapter,
  [camptocampAdapter.source]: camptocampAdapter,
  [skitourAdapter.source]: skitourAdapter,
  [gipfelbuchAdapter.source]: gipfelbuchAdapter,
};

/** Default backfill window: all of 2026 from Jan 1 up to "now". */
const DEFAULT_START_ISO = '2026-01-01T00:00:00Z';

/** Parses a bare YYYY-MM-DD (UTC midnight) or full ISO string into a Date. */
function parseDate(raw, label) {
  const s = String(raw).trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s;
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) {
    throw new Error(`Invalid ${label}: "${raw}" (use YYYY-MM-DD or a full ISO date)`);
  }
  return d;
}

function resolveStart() {
  const raw = (process.env.BACKFILL_START || '').trim();
  return raw ? parseDate(raw, 'BACKFILL_START') : new Date(DEFAULT_START_ISO);
}

function resolveEnd() {
  const raw = (process.env.BACKFILL_END || '').trim();
  return raw ? parseDate(raw, 'BACKFILL_END') : new Date();
}

/**
 * Builds the list of [start, end) month windows covering [start, end).
 * Each window starts at the 1st of a month at 00:00:00 UTC (except the first,
 * which starts exactly at `start`), and ends at the start of the next month
 * (except the last, which ends exactly at `end`).
 */
function monthWindows(start, end) {
  const windows = [];
  let cursor = new Date(start.getTime());
  while (cursor < end) {
    // First day of the NEXT month (UTC).
    const next = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1, 0, 0, 0)
    );
    const windowEnd = next < end ? next : end;
    windows.push({ start: new Date(cursor.getTime()), end: windowEnd });
    cursor = next;
  }
  return windows;
}

/** Short "YYYY-MM" label for logging a window. */
function monthLabel(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Backfills a single source across the given month windows. Returns the number
 * of items upserted. Does NOT touch crawler_state.
 */
async function backfillSource(pool, adapter, windows, { monthDelayMs }) {
  const { source } = adapter;
  // Some adapters need setup (e.g. powderguide's spot-location map) that the
  // runner normally provides via init(); replicate that here.
  const context = adapter.init ? await adapter.init() : undefined;

  let total = 0;
  const lastIdx = windows.length - 1;

  for (let i = 0; i <= lastIdx; i++) {
    const win = windows[i];
    const isLast = i === lastIdx;
    const startMs = win.start.getTime();
    const endMs = win.end.getTime();
    let processed = 0;

    for await (const item of adapter.iterate(win.start)) {
      const iso = adapter.itemDate(item);
      const t = iso ? new Date(iso).getTime() : NaN;

      if (Number.isFinite(t)) {
        // Keep only items that fall inside this window. Newer items belong to a
        // later window; older-than-start items (some sources overshoot) are
        // skipped here and covered by their own earlier window.
        if (t < startMs || t >= endMs) continue;
      } else {
        // Undated items can't be placed in a month; attribute them to the final
        // window only, so each is written exactly once (not per month).
        if (!isLast) continue;
      }

      await upsertRaw(pool, source, adapter.rawId(item), item);
      await upsertNormalized(pool, adapter.normalize(item, context));
      processed += 1;
      total += 1;
    }

    console.log(`[${source}] ${monthLabel(win.start)}: upserted ${processed} report(s).`);
    if (monthDelayMs > 0 && !isLast) await sleep(monthDelayMs);
  }

  return total;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const sources = args.filter((a) => !a.startsWith('--'));
  return {
    confirm: flags.has('--confirm'),
    dryRun: flags.has('--dry-run'),
    sources,
  };
}

async function main() {
  const { confirm, dryRun, sources } = parseArgs(process.argv);

  const names = sources.length ? sources : Object.keys(ADAPTERS);
  const unknown = names.filter((n) => !ADAPTERS[n]);
  if (unknown.length) {
    throw new Error(
      `Unknown source(s): ${unknown.join(', ')}. Known: ${Object.keys(ADAPTERS).join(', ')}`
    );
  }

  const start = resolveStart();
  const end = resolveEnd();
  if (end <= start) {
    throw new Error(`BACKFILL_END (${end.toISOString()}) must be after BACKFILL_START (${start.toISOString()})`);
  }
  const windows = monthWindows(start, end);
  const monthDelayMs = Number(process.env.BACKFILL_MONTH_DELAY_MS || '0');

  console.log('=== Alpica backfill (monthly batches, watermark untouched) ===');
  console.log(`window   : ${start.toISOString()} -> ${end.toISOString()}`);
  console.log(`batches  : ${windows.length} month(s) [${windows.map((w) => monthLabel(w.start)).join(', ')}]`);
  console.log(`sources  : ${names.join(', ')}`);
  console.log(`month gap: ${monthDelayMs} ms`);

  if (!confirm || dryRun) {
    console.log('');
    console.log(
      dryRun
        ? 'DRY RUN — no DB writes, no API calls. Re-run with --confirm to execute.'
        : 'No --confirm flag given. This would write to the database (prod).'
    );
    console.log('To execute: node crawler/src/backfill-2026.js --confirm [sources...]');
    return;
  }

  const pool = getPool();
  let hadError = false;

  // Run sources sequentially so one failure doesn't abort the rest.
  for (const name of names) {
    try {
      console.log(`\n[${name}] backfilling ${windows.length} month(s)...`);
      const total = await backfillSource(pool, ADAPTERS[name], windows, { monthDelayMs });
      console.log(`[${name}] backfill done. total upserted: ${total} report(s).`);
    } catch (err) {
      hadError = true;
      console.error(`[${name}] backfill failed:`, err.message || err);
    }
  }

  if (hadError) {
    throw new Error('One or more backfills failed');
  }
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('backfill run failed:', err.message || err);
    await closePool();
    process.exit(1);
  });
