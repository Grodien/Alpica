import { createHash } from 'node:crypto';
import { getPool } from '@alpica/db';

/**
 * Express middleware that authenticates requests using an API key supplied in
 * the `x-api-key` header (or `Authorization: Bearer <key>`).
 *
 * Only the SHA-256 hash of each key is stored in the `api_keys` table, so we
 * hash the presented key and look it up. The exact-match lookup on the stored
 * hash is the authoritative comparison. (A timing-safe compare would add no
 * real protection here: we compare hashes, not the secret itself, and the
 * decisive comparison happens inside the DB query anyway.)
 *
 * Rate limiting: each key may have an hourly cap (`rate_limit_per_hour`).
 *   - NULL  => unlimited (no counting).
 *   - N     => at most N requests per fixed hour window; over the cap returns
 *              429 with a Retry-After header.
 */
export function apiKeyAuth() {
  return async (req, res, next) => {
    try {
      const presented = extractKey(req);
      if (!presented) {
        return res.status(401).json({ error: 'Missing API key' });
      }

      const presentedHash = sha256(presented);
      const pool = getPool();
      const [rows] = await pool.query(
        'SELECT id, rate_limit_per_hour FROM api_keys WHERE key_hash = ? AND is_active = 1 LIMIT 1',
        [presentedHash]
      );

      if (rows.length === 0) {
        return res.status(401).json({ error: 'Invalid API key' });
      }

      const { id: apiKeyId, rate_limit_per_hour: hourlyLimit } = rows[0];

      // Usage is tracked for EVERY key (limited or not) so unlimited keys still
      // get per-hour statistics. For unlimited keys we just count; for limited
      // keys we also read the count back and enforce the cap.
      if (hourlyLimit == null) {
        // Fire-and-forget: usage stats must never block or fail a request.
        // No count read-back needed since there is no cap to check.
        incrementUsage(pool, apiKeyId, { readBack: false }).catch(() => {});
      } else {
        const { count, windowStart } = await incrementUsage(pool, apiKeyId);
        if (count > hourlyLimit) {
          const retryAfter = secondsUntilNextWindow(windowStart);
          res.set('Retry-After', String(retryAfter));
          return res.status(429).json({
            error: 'Rate limit exceeded',
            limit: hourlyLimit,
            retryAfterSeconds: retryAfter,
          });
        }
      }

      // Best-effort usage timestamp; don't block the request on it.
      pool
        .query('UPDATE api_keys SET last_used_at = NOW() WHERE id = ?', [apiKeyId])
        .catch(() => {});

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Atomically increments the request counter for the current fixed hour window.
 * The INSERT ... ON DUPLICATE KEY UPDATE avoids a read-then-write race between
 * concurrent requests.
 *
 * @param {object} [options]
 * @param {boolean} [options.readBack=true] whether to read the new count back
 *   (needed only when a limit must be enforced). When false, skips the extra
 *   SELECT — used for unlimited keys that only need usage tracking.
 * @returns {Promise<{count: number|null, windowStart: string}>}
 */
async function incrementUsage(pool, apiKeyId, { readBack = true } = {}) {
  const windowStart = currentWindowStart();
  await pool.query(
    `INSERT INTO api_key_usage (api_key_id, window_start, request_count)
     VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE request_count = request_count + 1`,
    [apiKeyId, windowStart]
  );
  if (!readBack) {
    return { count: null, windowStart };
  }
  const [rows] = await pool.query(
    'SELECT request_count FROM api_key_usage WHERE api_key_id = ? AND window_start = ?',
    [apiKeyId, windowStart]
  );
  return { count: rows[0]?.request_count ?? 1, windowStart };
}

/** Start of the current fixed hour window as a MySQL DATETIME (UTC) string. */
function currentWindowStart() {
  const now = new Date();
  now.setUTCMinutes(0, 0, 0);
  return now.toISOString().slice(0, 19).replace('T', ' ');
}

/** Seconds remaining until the next hour window begins. */
function secondsUntilNextWindow(windowStartStr) {
  const start = new Date(windowStartStr.replace(' ', 'T') + 'Z').getTime();
  const nextWindow = start + 3600 * 1000;
  return Math.max(1, Math.ceil((nextWindow - Date.now()) / 1000));
}

function extractKey(req) {
  const header = req.get('x-api-key');
  if (header) return header.trim();
  const auth = req.get('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return null;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
