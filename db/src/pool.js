import mysql from 'mysql2/promise';
import { loadEnv, optionalEnv, requireEnv } from './env.js';

let pool;

/**
 * Returns a lazily-created shared MySQL connection pool.
 * Credentials come exclusively from environment variables (.env).
 */
export function getPool() {
  if (pool) return pool;
  loadEnv();

  pool = mysql.createPool({
    host: requireEnv('DB_HOST'),
    port: Number(optionalEnv('DB_PORT', '3306')),
    database: requireEnv('DB_NAME'),
    user: requireEnv('DB_USER'),
    password: requireEnv('DB_PASSWORD'),
    connectionLimit: Number(optionalEnv('DB_CONNECTION_LIMIT', '10')),
    waitForConnections: true,
    queueLimit: 0,
    // Return DATETIME columns as strings to avoid timezone surprises.
    dateStrings: true,
    // Named placeholders (:name) are convenient for the api queries.
    namedPlaceholders: true,
  });

  return pool;
}

/**
 * Closes the pool. Call this from short-lived scripts (crawler, migrate) so the
 * process can exit cleanly.
 */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
