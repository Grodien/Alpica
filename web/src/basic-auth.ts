import { timingSafeEqual } from 'node:crypto';
import type express from 'express';

/**
 * Optional site-wide HTTP Basic Auth, used as a pre-launch gate so the site is
 * not publicly reachable before go-live.
 *
 * Enabled only when SITE_PASSWORD is set in the environment. When enabled,
 * EVERY request must carry valid Basic Auth credentials, otherwise the browser
 * shows the native login prompt (401) and nothing is served — not the page, not
 * the assets, not the /api/* proxy.
 *
 * To go live: remove SITE_PASSWORD (and SITE_USERNAME) from .env and restart.
 *
 * Config:
 *   SITE_PASSWORD   if set (non-empty), the gate is active. If unset/empty, the
 *                   middleware is a no-op and the site is public.
 *   SITE_USERNAME   expected username (defaults to "preview").
 *   SITE_AUTH_REALM optional realm text shown in the browser prompt.
 */

/** Constant-time string compare that doesn't leak length via early return. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    // Still do a comparison to keep timing roughly constant, then fail.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** Parses an "Authorization: Basic <base64>" header into user/pass. */
function parseBasicAuth(header: string | undefined): { user: string; pass: string } | null {
  if (!header) return null;
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return null;
  }
  const sep = decoded.indexOf(':');
  if (sep === -1) return null;
  return { user: decoded.slice(0, sep), pass: decoded.slice(sep + 1) };
}

/**
 * Returns an Express middleware enforcing Basic Auth when SITE_PASSWORD is set,
 * and a transparent pass-through otherwise.
 */
export function siteBasicAuth(): express.RequestHandler {
  const expectedPass = process.env['SITE_PASSWORD'] ?? '';
  const expectedUser = process.env['SITE_USERNAME'] || 'preview';
  const realm = (process.env['SITE_AUTH_REALM'] || 'Restricted — preview').replace(/"/g, '');

  // Gate disabled: no password configured, site is public.
  if (!expectedPass) {
    return (_req, _res, next) => next();
  }

  return (req, res, next) => {
    // Never gate the ACME challenge path, so HTTP->HTTPS cert issuance/renewal
    // keeps working even if this ever reaches Node directly.
    if (req.path.startsWith('/.well-known/acme-challenge/')) {
      next();
      return;
    }

    const creds = parseBasicAuth(req.headers.authorization);
    const ok =
      creds !== null &&
      safeEqual(creds.user, expectedUser) &&
      safeEqual(creds.pass, expectedPass);

    if (!ok) {
      res.setHeader('WWW-Authenticate', `Basic realm="${realm}", charset="UTF-8"`);
      res.status(401).type('text/plain').send('Authentication required');
      return;
    }

    next();
  };
}
