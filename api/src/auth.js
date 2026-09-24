import { createHash, timingSafeEqual } from 'node:crypto';
import { getPool } from '@alpica/db';

/**
 * Express middleware that authenticates requests using an API key supplied in
 * the `x-api-key` header (or `Authorization: Bearer <key>`).
 *
 * Only the SHA-256 hash of each key is stored in the `api_keys` table, so we
 * hash the presented key and look it up. The lookup is by exact hash; we also
 * do a constant-time comparison as defense in depth.
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
        'SELECT id, key_hash FROM api_keys WHERE key_hash = ? AND is_active = 1 LIMIT 1',
        [presentedHash]
      );

      if (rows.length === 0 || !safeEqualHex(rows[0].key_hash, presentedHash)) {
        return res.status(401).json({ error: 'Invalid API key' });
      }

      // Best-effort usage timestamp; don't block the request on it.
      pool
        .query('UPDATE api_keys SET last_used_at = NOW() WHERE id = ?', [rows[0].id])
        .catch(() => {});

      req.apiKeyId = rows[0].id;
      next();
    } catch (err) {
      next(err);
    }
  };
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

function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
