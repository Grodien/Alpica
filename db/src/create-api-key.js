import { createHash, randomBytes } from 'node:crypto';
import { closePool, getPool } from './pool.js';
import { loadEnv } from './env.js';

/**
 * Generates a new API key, stores only its SHA-256 hash in the `api_keys` table,
 * and prints the plaintext key ONCE. The plaintext is never stored and cannot be
 * recovered later.
 *
 * Usage:
 *   npm run create-api-key -- "my label"                # unlimited
 *   npm run create-api-key -- "my label" 1000           # 1000 requests/hour
 *   node db/src/create-api-key.js "my label" 1000
 *
 * Arguments:
 *   label (optional)  identifies the key later (e.g. which client). Default "generated".
 *   limit (optional)  hourly request cap. Omit or pass 0 / "unlimited" for no limit.
 */
async function run() {
  loadEnv();
  const label = (process.argv[2] ?? 'generated').slice(0, 255);
  const rateLimit = parseRateLimit(process.argv[3]);

  const apiKey = randomBytes(24).toString('hex'); // 48 hex chars
  const keyHash = createHash('sha256').update(apiKey).digest('hex');

  const pool = getPool();
  await pool.query(
    'INSERT INTO api_keys (label, key_hash, rate_limit_per_hour) VALUES (?, ?, ?)',
    [label, keyHash, rateLimit]
  );

  console.log('\n============================================================');
  console.log('  New API key created. Store it now — it is NOT recoverable');
  console.log('  (only its SHA-256 hash is saved in the DB).');
  console.log('');
  console.log(`  label: ${label}`);
  console.log(`  limit: ${rateLimit == null ? 'unlimited' : `${rateLimit} requests/hour`}`);
  console.log(`  key:   ${apiKey}`);
  console.log('');
  console.log('  For the website, put it in .env as:');
  console.log(`  API_KEY=${apiKey}`);
  console.log('============================================================\n');
}

/**
 * Parses the optional rate-limit argument.
 *   undefined / "" / "0" / "unlimited" / "none"  -> null (unlimited)
 *   positive integer                             -> that number
 */
function parseRateLimit(arg) {
  if (arg === undefined || arg === '' || /^(unlimited|none)$/i.test(arg)) {
    return null;
  }
  const n = Number.parseInt(arg, 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

run()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err.message || err);
    await closePool();
    process.exit(1);
  });
