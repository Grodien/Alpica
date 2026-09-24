import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

/**
 * Loads the nearest `.env` file, searching from this package upward to the
 * monorepo root. This lets every package (crawler, api, db) share a single
 * root `.env` while still allowing a package-local `.env` to override it.
 */
let loaded = false;

export function loadEnv() {
  if (loaded) return;
  loaded = true;

  const here = dirname(fileURLToPath(import.meta.url));
  // Search from db/src upward for a .env file.
  const candidates = [
    resolve(here, '../../.env'), // monorepo root (db/src -> db -> root)
    resolve(here, '../.env'), // db package dir
    resolve(process.cwd(), '.env'), // wherever the process was started
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      dotenv.config({ path: candidate });
      break;
    }
  }
}

/**
 * Returns a required env var or throws a helpful error.
 */
export function requireEnv(name) {
  loadEnv();
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `Missing required environment variable "${name}". ` +
        `Copy .env.example to .env and fill it in.`
    );
  }
  return value;
}

/**
 * Returns an optional env var, or the provided default.
 */
export function optionalEnv(name, fallback) {
  loadEnv();
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}
