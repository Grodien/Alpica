import { closePool, getPool } from '@alpica/db';
import { runCrawl } from './runner.js';
import { powderguideAdapter } from './powderguide.js';
import { camptocampAdapter } from './camptocamp.js';
import { skitourAdapter } from './skitour.js';

/**
 * Crawler entry point. Runs one or more source adapters through the generic
 * crawl runner. Designed to be run by a scheduled task (cron / launchd /
 * systemd timer) and exit when finished.
 *
 * Usage:
 *   node src/index.js                 # run all sources
 *   node src/index.js camptocamp      # run a single source
 *   node src/index.js powderguide camptocamp
 */
const ADAPTERS = {
  [powderguideAdapter.source]: powderguideAdapter,
  [camptocampAdapter.source]: camptocampAdapter,
  [skitourAdapter.source]: skitourAdapter,
};

async function main() {
  const requested = process.argv.slice(2);
  const names = requested.length ? requested : Object.keys(ADAPTERS);

  const unknown = names.filter((n) => !ADAPTERS[n]);
  if (unknown.length) {
    throw new Error(
      `Unknown source(s): ${unknown.join(', ')}. Known: ${Object.keys(ADAPTERS).join(', ')}`
    );
  }

  const pool = getPool();
  let hadError = false;

  // Run sources sequentially so a failure in one doesn't abort the others.
  for (const name of names) {
    try {
      await runCrawl(pool, ADAPTERS[name]);
    } catch (err) {
      hadError = true;
      console.error(`[${name}] crawl failed:`, err.message || err);
    }
  }

  if (hadError) {
    throw new Error('One or more crawls failed');
  }
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('crawl run failed:', err.message || err);
    await closePool();
    process.exit(1);
  });
