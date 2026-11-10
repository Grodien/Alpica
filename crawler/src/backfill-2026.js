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

/** Timestamped log line, e.g. "[14:03:21] ...". */
function log(...args) {
  const ts = new Date().toISOString().slice(11, 19); // HH:MM:SS (UTC)
  console.log(`[${ts}]`, ...args);
}

/** Human-friendly elapsed time, e.g. "4.2s" or "1m 05s". */
function fmtDuration(ms) {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${String(rem).padStart(2, '0')}s`;
}

/** How often (in items seen) to emit an in-progress tick during iteration. */
const PROGRESS_EVERY = 25;

/**
 * Parses a normalized `report_date` ("YYYY-MM-DD hh:mm:ss", UTC) or an ISO
 * string into epoch ms, or NaN if absent/invalid.
 */
function reportDateMs(normalized) {
  const v = normalized?.report_date;
  if (!v) return NaN;
  // The normalized value is a MySQL UTC datetime "YYYY-MM-DD hh:mm:ss".
  const iso = /^\d{4}-\d{2}-\d{2} /.test(v) ? v.replace(' ', 'T') + 'Z' : v;
  return new Date(iso).getTime();
}

/**
 * Backfills a source whose FETCH dimension matches the activity date
 * (camptocamp, skitour, gipfelbuch). We fetch one month window at a time
 * (iterate(windowStart)) so each request window is small and the per-source
 * caps aren't hit, and we keep only items whose activity date
 * (normalized report_date) falls inside the window.
 */
async function backfillByMonth(pool, adapter, windows, context, { monthDelayMs }) {
  const { source } = adapter;
  let total = 0;
  const lastIdx = windows.length - 1;

  for (let i = 0; i <= lastIdx; i++) {
    const win = windows[i];
    const isLast = i === lastIdx;
    const startMs = win.start.getTime();
    const endMs = win.end.getTime();
    const month = monthLabel(win.start);
    const monthStarted = Date.now();
    let seen = 0;
    let processed = 0;

    log(
      `[${source}] ${month} (${i + 1}/${windows.length}): fetching ` +
      `${win.start.toISOString().slice(0, 10)} … ${win.end.toISOString().slice(0, 10)} …`
    );

    // Pass the window end as an upper bound so sources with a hard result cap
    // and no pagination (gipfelbuch) or newest-first paging (skitour,
    // camptocamp) don't truncate a long range — each request covers one month.
    for await (const item of adapter.iterate(win.start, win.end)) {
      seen += 1;
      const normalized = adapter.normalize(item, context);
      const t = reportDateMs(normalized);

      if (Number.isFinite(t)) {
        // Keep only items whose activity date is inside this month window.
        if (t < startMs || t >= endMs) {
          if (seen % PROGRESS_EVERY === 0) {
            log(`[${source}] ${month}:   …seen ${seen}, kept ${processed} so far`);
          }
          continue;
        }
      } else if (!isLast) {
        // Undated items: write once, in the final window only.
        continue;
      }

      await upsertRaw(pool, source, adapter.rawId(item), item);
      await upsertNormalized(pool, normalized);
      processed += 1;
      total += 1;

      if (seen % PROGRESS_EVERY === 0) {
        log(`[${source}] ${month}:   …seen ${seen}, kept ${processed} so far`);
      }
    }

    log(
      `[${source}] ${month} done: seen ${seen}, upserted ${processed} report(s) ` +
      `in ${fmtDuration(Date.now() - monthStarted)} (running total ${total}).`
    );
    if (monthDelayMs > 0 && !isLast) {
      log(`[${source}] pausing ${monthDelayMs}ms before next month …`);
      await sleep(monthDelayMs);
    }
  }

  return total;
}

/**
 * Backfills a source whose FETCH dimension is decoupled from the activity date
 * (powderguide: server-side `newer_than` runs on `updated_at`, which is often a
 * single recent bulk-update timestamp). Monthly `newer_than` windowing would
 * drop almost everything, so we do ONE forward pass from the overall start and
 * keep every item whose activity date falls in the overall [start, end) range.
 * This source paginates with no item cap, so a single pass is safe.
 */
async function backfillSinglePass(pool, adapter, start, end, context) {
  const { source } = adapter;
  const startMs = start.getTime();
  const endMs = end.getTime();
  const passStarted = Date.now();
  // Per-month tallies purely for logging parity with the monthly path.
  const perMonth = new Map();
  let seen = 0;
  let total = 0;
  let outside = 0;
  let undated = 0;

  log(`[${source}] single forward pass from ${start.toISOString()} (paging all; may take a while) …`);

  for await (const item of adapter.iterate(start)) {
    seen += 1;
    const normalized = adapter.normalize(item, context);
    const t = reportDateMs(normalized);

    if (Number.isFinite(t)) {
      if (t < startMs || t >= endMs) {
        outside += 1;
        if (seen % PROGRESS_EVERY === 0) {
          log(`[${source}]   …seen ${seen}, kept ${total}, outside-range ${outside}`);
        }
        continue; // outside the backfill range
      }
      const key = monthLabel(new Date(t));
      perMonth.set(key, (perMonth.get(key) ?? 0) + 1);
    } else {
      undated += 1;
    }

    await upsertRaw(pool, source, adapter.rawId(item), item);
    await upsertNormalized(pool, normalized);
    total += 1;

    if (seen % PROGRESS_EVERY === 0) {
      log(`[${source}]   …seen ${seen}, kept ${total}, outside-range ${outside}`);
    }
  }

  log(
    `[${source}] pass done: seen ${seen}, upserted ${total} report(s), ` +
    `skipped ${outside} outside range, in ${fmtDuration(Date.now() - passStarted)}.`
  );
  // Per-month breakdown so you can sanity-check the distribution.
  for (const [month, count] of [...perMonth.entries()].sort()) {
    log(`[${source}]   ${month}: ${count} report(s)`);
  }
  if (undated) log(`[${source}]   (no activity date): ${undated} report(s)`);
  return total;
}

/**
 * Backfills a single source across the given month windows. Returns the number
 * of items upserted. Does NOT touch crawler_state.
 */
async function backfillSource(pool, adapter, windows, start, end, opts) {
  // Some adapters need setup (e.g. powderguide's spot-location map) that the
  // runner normally provides via init(); replicate that here.
  let context;
  if (adapter.init) {
    log(`[${adapter.source}] initializing (loading source metadata) …`);
    context = await adapter.init();
    log(`[${adapter.source}] init complete.`);
  }

  if (adapter.backfillFetchBy === 'updatedAt') {
    // Fetch dimension is decoupled from activity date -> single forward pass.
    return backfillSinglePass(pool, adapter, start, end, context);
  }
  return backfillByMonth(pool, adapter, windows, context, opts);
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
  console.log(`progress : a tick every ${PROGRESS_EVERY} items seen`);

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
  const runStarted = Date.now();
  const summary = [];

  // Run sources sequentially so one failure doesn't abort the rest.
  for (let s = 0; s < names.length; s++) {
    const name = names[s];
    const mode = ADAPTERS[name].backfillFetchBy === 'updatedAt' ? 'single pass' : `${windows.length} monthly batches`;
    const srcStarted = Date.now();
    log(`\n=== source ${s + 1}/${names.length}: ${name} (${mode}) ===`);
    try {
      const total = await backfillSource(pool, ADAPTERS[name], windows, start, end, { monthDelayMs });
      const took = fmtDuration(Date.now() - srcStarted);
      log(`[${name}] ✓ done — ${total} report(s) upserted in ${took}.`);
      summary.push({ name, total, took, ok: true });
    } catch (err) {
      hadError = true;
      const took = fmtDuration(Date.now() - srcStarted);
      log(`[${name}] ✗ FAILED after ${took}: ${err.message || err}`);
      summary.push({ name, total: 0, took, ok: false });
    }
  }

  // Final summary table.
  console.log('\n=== backfill summary ===');
  for (const r of summary) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.name.padEnd(12)} ${String(r.total).padStart(6)} report(s)  (${r.took})`);
  }
  const grand = summary.reduce((n, r) => n + r.total, 0);
  console.log(`  total upserted: ${grand} report(s) in ${fmtDuration(Date.now() - runStarted)}`);

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
