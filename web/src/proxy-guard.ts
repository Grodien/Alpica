import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type express from 'express';

/**
 * Guards the same-origin proxy endpoints (/api/*) so they can only realistically
 * be used by our own app, not by other sites or scripts.
 *
 * This layers four defenses. None is individually bulletproof (a determined
 * attacker with curl can forge headers), but together they block the practical
 * abuse cases: another website embedding our proxy via JS, casual scraping, and
 * calls made outside a real page session.
 *
 *  (a) Strict CORS       — browsers refuse cross-origin use from other sites.
 *  (b) Origin/Referer    — server-side check that the request came from us.
 *  (c) Rate limiting     — per-IP cap to blunt scraping.
 *  (d) Session token     — an HMAC cookie the SSR page sets and the proxy
 *                          requires, so calls must originate from a rendered page.
 */

/** Allowed browser origins. Configure via WEB_ALLOWED_ORIGINS (comma-separated). */
function allowedOrigins(): string[] {
  const raw = process.env['WEB_ALLOWED_ORIGINS'];
  if (raw && raw.trim()) {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
  }
  // Dev default.
  return ['http://localhost:4000', 'http://127.0.0.1:4000'];
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  return allowedOrigins().includes(origin);
}

// --- (d) Session token ------------------------------------------------------

const SESSION_COOKIE = 'mr_sess';
// Secret for signing the session token. In production set WEB_SESSION_SECRET;
// otherwise a random per-process secret is used (fine for a single instance).
const SESSION_SECRET = process.env['WEB_SESSION_SECRET'] || randomBytes(32).toString('hex');
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

/** Creates a signed token "expiry.signature" valid for SESSION_TTL_MS. */
export function issueSessionToken(): string {
  const expiry = Date.now() + SESSION_TTL_MS;
  const sig = sign(String(expiry));
  return `${expiry}.${sig}`;
}

function sign(value: string): string {
  return createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}

function isValidSessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const dot = token.indexOf('.');
  if (dot === -1) return false;
  const expiryStr = token.slice(0, dot);
  const providedSig = token.slice(dot + 1);
  const expiry = Number(expiryStr);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;
  const expectedSig = sign(expiryStr);
  return safeEqual(providedSig, expectedSig);
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Minimal cookie parser (avoids adding a dependency). */
function readCookie(req: express.Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/**
 * Sets the session cookie on HTML page responses so that subsequently the
 * browser sends it back with /api/* requests. Call this for the SSR page route.
 */
export function setSessionCookie(res: express.Response): void {
  const token = issueSessionToken();
  const secure = process.env['WEB_COOKIE_SECURE'] === 'true';
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    maxAge: SESSION_TTL_MS,
    path: '/',
  });
}

// --- (c) Rate limiting (per IP, fixed window) -------------------------------

const RATE_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_MAX = Number(process.env['WEB_PROXY_RATE_LIMIT'] || '120'); // per window
const hits = new Map<string, { count: number; windowStart: number }>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.windowStart >= RATE_WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RATE_MAX;
}

// Periodically drop stale entries so the map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of hits) {
    if (now - entry.windowStart >= RATE_WINDOW_MS) hits.delete(ip);
  }
}, RATE_WINDOW_MS).unref?.();

// --- CORS + guard middleware ------------------------------------------------

/**
 * Applies strict CORS headers for the proxy routes. Only echoes the Origin back
 * when it is on the allowlist; other origins get no CORS headers, so browsers
 * block the response.
 */
export function proxyCors(): express.RequestHandler {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isAllowedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') {
      // Preflight: allowed origins get 204, others fall through to be blocked.
      if (origin && isAllowedOrigin(origin)) {
        res.status(204).end();
        return;
      }
      res.status(403).end();
      return;
    }
    next();
  };
}

/**
 * The main guard for /api/* proxy routes: rate limit, origin/referer check, and
 * session-token check.
 */
export function proxyGuard(): express.RequestHandler {
  return (req, res, next) => {
    // (c) Rate limit per client IP.
    const ip = clientIp(req);
    if (rateLimited(ip)) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    // (b) Origin / Referer must belong to us. Requests carrying an Origin or
    // Referer from another site are rejected. (Same-origin browser fetches send
    // an Origin header equal to our site; we validate against the allowlist.)
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    if (origin) {
      if (!isAllowedOrigin(origin)) {
        res.status(403).json({ error: 'Forbidden origin' });
        return;
      }
    } else if (referer) {
      if (!allowedOrigins().some((o) => referer.startsWith(o + '/') || referer === o)) {
        res.status(403).json({ error: 'Forbidden referer' });
        return;
      }
    }

    // (d) Require a valid session token issued by our SSR page.
    const token = readCookie(req, SESSION_COOKIE);
    if (!isValidSessionToken(token)) {
      res.status(401).json({ error: 'Missing or invalid session' });
      return;
    }

    next();
  };
}

function clientIp(req: express.Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}
