import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, getPool } from './pool.js';
import { loadEnv } from './env.js';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

/**
 * Very small forward-only migration runner. Applies every *.sql file in
 * `migrations/` (sorted by name) that hasn't been recorded yet.
 */
async function run() {
  loadEnv();
  const pool = getPool();

  // Bookkeeping table for applied migrations.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       VARCHAR(255) NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  const [appliedRows] = await pool.query('SELECT name FROM schema_migrations');
  const applied = new Set(appliedRows.map((r) => r.name));

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`= skip   ${file} (already applied)`);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    console.log(`+ apply  ${file}`);
    // Split on ";" at statement boundaries so multi-statement files work with
    // the default (non-multi-statement) connection.
    const statements = splitSqlStatements(sql);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const stmt of statements) {
        await conn.query(stmt);
      }
      await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw new Error(`Migration ${file} failed: ${err.message}`);
    } finally {
      conn.release();
    }
  }

  await ensureFirstApiKey(pool);

  console.log('Migrations complete.');
}

/**
 * Splits a SQL file into individual statements. Handles line comments and
 * keeps it simple: our migrations don't use stored procedures or ; in strings.
 */
function splitSqlStatements(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * On first setup, generate one API key and print it ONCE (only the hash is
 * stored). Subsequent runs are no-ops if any key already exists.
 */
async function ensureFirstApiKey(pool) {
  const [rows] = await pool.query('SELECT COUNT(*) AS c FROM api_keys');
  if (rows[0].c > 0) return;

  const apiKey = randomBytes(24).toString('hex'); // 48 hex chars
  const keyHash = createHash('sha256').update(apiKey).digest('hex');
  await pool.query('INSERT INTO api_keys (label, key_hash) VALUES (?, ?)', [
    'initial',
    keyHash,
  ]);

  console.log('\n============================================================');
  console.log('  Generated an initial API key. Store it now — it is NOT');
  console.log('  recoverable (only its SHA-256 hash is saved in the DB).');
  console.log('  Put it in your .env as API_KEY=...');
  console.log('');
  console.log(`  API_KEY=${apiKey}`);
  console.log('============================================================\n');
}

run()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err.message || err);
    await closePool();
    process.exit(1);
  });
