# Alpica

Aggregates mountain conditions reports from external APIs into a normalized data
store, exposes them through a protected API, and presents them on a server-side
rendered Angular website.

## Components

| Component | Path | Description |
|-----------|------|-------------|
| **db**      | `db`      | Shared MySQL connection pool + SQL migrations. |
| **crawler** | `crawler` | Scheduled Node.js scripts that pull data from source APIs (PowderGuide, Camptocamp, skitour.fr) and store it raw + normalized. |
| **api**     | `api`     | Node.js/Express read API over the normalized data, protected by an API key. |
| **web**     | `web`              | Server-side rendered Angular site. Talks to the API server-side so the API key is never exposed to the browser. |

## Prerequisites

- Node.js >= 20
- A reachable MySQL database

## Setup

```bash
# 1. Install workspace dependencies (crawler, api, db)
npm install

# 2. Configure environment
cp .env.example .env
# edit .env and fill in the real DB credentials + API key

# 3. Run database migrations (creates tables + a first API key)
npm run migrate

# 4. Run the crawler once (wire this to cron / launchd for scheduling)
npm run crawl                 # all sources
npm run crawl -- camptocamp   # a single source (powderguide | camptocamp)

# 5. Start the API
npm run api
```

The website has its own toolchain:

```bash
cd web
npm install
npm run build && npm run serve:ssr   # reads the single root .env (../.env)
```

There is a single `.env` at the repo root; every component (db, crawler, api,
and the web SSR server) reads it. The web `serve:ssr` script loads it via
`--env-file=../.env`.

The interactive map re-queries as the user pans/zooms, which is inherently a
client-side action. So the browser calls same-origin proxy endpoints on the SSR
server (`/api/bbox`, `/api/search`); the server injects the `x-api-key` header
and forwards to the internal API. The real API URL and key are never present in
the HTML or the client bundle.

## Security posture

- **The internal API is not reachable from outside the host.** It binds to
  `127.0.0.1` by default (`API_HOST`), so only the co-located web SSR server
  talks to it. Do not set `API_HOST=0.0.0.0` unless you deliberately want to
  expose it.
- The API key is required on every internal API request (`x-api-key` header) and
  only its SHA-256 hash is stored in `api_keys`.
- The browser never sees the API key or the internal API URL — the SSR proxy
  adds them server-side.
- The SSR server enforces a Host-header allowlist via `NG_ALLOWED_HOSTS`
  (protects against host-header / DNS-rebinding attacks). Set it to your real
  domain(s) in production.

### Protecting the same-origin proxy (`/api/*`)

The proxy endpoints are public (the users' browsers must reach them), so they
are guarded to make casual misuse by other sites/scripts impractical. Note this
cannot be fully airtight — anyone with `curl` can forge headers — but it blocks
the realistic abuse cases. Four layers (see `web/src/proxy-guard.ts`):

- **Strict CORS** — only origins in `WEB_ALLOWED_ORIGINS` may use the proxy from
  a browser; other sites' cross-origin `fetch` is blocked.
- **Origin/Referer check** — requests carrying an `Origin`/`Referer` from another
  site are rejected server-side (`403`).
- **Per-IP rate limit** — `WEB_PROXY_RATE_LIMIT` requests per minute per IP;
  over the cap returns `429`.
- **Session token** — each rendered page sets a short-lived, HMAC-signed
  `HttpOnly` cookie (`WEB_SESSION_SECRET`); the proxy requires it, so calls must
  come from a real page session (missing/invalid → `401`).

Configure via `WEB_ALLOWED_ORIGINS`, `WEB_SESSION_SECRET`, `WEB_COOKIE_SECURE`
(set `true` behind HTTPS), and `WEB_PROXY_RATE_LIMIT`. In production set a fixed
`WEB_SESSION_SECRET` (a random per-process one breaks sessions across restarts /
multiple instances).

## API keys

The first key is created automatically on the initial `npm run migrate` (only
when `api_keys` is empty). To create additional keys:

```bash
npm run create-api-key -- "some label"          # unlimited
npm run create-api-key -- "some label" 1000      # 1000 requests/hour
```

This prints the plaintext key ONCE (only its SHA-256 hash is stored, so it
cannot be recovered later). The label is optional and just helps you identify
the key. Put the key in `.env` as `API_KEY=...` for the website, or hand it to
whatever client needs API access.

### Rate limiting

Each key can have an hourly request cap (`api_keys.rate_limit_per_hour`):

- `NULL` — unlimited (the default). Requests are still counted for statistics,
  but never blocked.
- `N` — at most `N` requests per fixed hour window. Requests over the cap get
  `429 Too Many Requests` with a `Retry-After` header.

Usage is tracked per key and hour in `api_key_usage` for **every** key (limited
or not), via atomic upserts so counts survive restarts. Inspect usage with:

```sql
SELECT k.label, u.window_start, u.request_count
FROM api_key_usage u JOIN api_keys k ON k.id = u.api_key_id
ORDER BY u.window_start DESC;
```

Change a limit for an existing key directly in the DB:

```sql
-- set a limit
UPDATE api_keys SET rate_limit_per_hour = 1000 WHERE label = 'some label';
-- make it unlimited again
UPDATE api_keys SET rate_limit_per_hour = NULL WHERE label = 'some label';
```

To revoke a key, deactivate it in the database:

```sql
UPDATE api_keys SET is_active = 0 WHERE label = 'some label';
```

## Local development database (Podman)

Spin up a throwaway MySQL that matches `.env`:

```bash
podman run -d --name alpica-mysql \
  -e MYSQL_ROOT_PASSWORD=root-dev-pw \
  -e MYSQL_DATABASE=<your DATABASE> \
  -e MYSQL_USER=<your DB_USER> \
  -e MYSQL_PASSWORD=<your DB_PASSWORD> \
  -p 3306:3306 \
  docker.io/library/mysql:8.4

# later: stop / remove
podman stop alpica-mysql && podman rm alpica-mysql
```

## Environment / secrets

All credentials live in `.env` files that are **git-ignored**. See
`.env.example` for the full list of variables. Never commit real secrets.

## Data model

- `raw_reports` — the untouched JSON payload from each source, for reprocessing.
- `reports` — the normalized, queryable schema (the API reads only this table).
- `crawler_state` — per-source watermark so each crawl only fetches the delta.
- `api_keys` — hashed API keys that authorize access to the API.

## Crawler sources

Each source is a small adapter (`crawler/src/<source>.js`) plugged into a shared
runner (`crawler/src/runner.js`) that handles the watermark, raw + normalized
upserts, and run status. Adding a source means writing one adapter and
registering it in `crawler/src/index.js`.

Current sources:

- **powderguide** — PowderGuide conditions reports. Incremental via the API's
  `newer_than` filter.
- **camptocamp** — Camptocamp (C2C) `/outings`. Coordinates arrive in EPSG:3857
  (Web Mercator) and are converted to WGS84 lat/long. Incremental by paging
  newest-first and stopping at the watermark; capped per run by
  `CAMPTOCAMP_MAX_ITEMS`. Requests use retry + backoff since the API can be flaky.
  Thumbnails: list items carry no image, so for outings that have images the
  crawler fetches the outing detail and builds a media URL from the first image's
  filename (`https://media.camptocamp.org/c2corg-active/<name><size>.jpg`, size
  `SI`/`MI`/`BI`). This costs one extra request per outing-with-images; disable
  with `CAMPTOCAMP_FETCH_THUMBNAILS=false`.
- **skitour** — skitour.fr `/sorties` (ski-touring outings). Auth is a custom
  `cle` header (`SKITOUR_API_KEY`). Requesting with `c=1` returns coordinates
  (`sommets`/`depart`, already WGS84), a free-text place (massif + spot), the
  author, and photo URLs — so title, location, and thumbnail all come in one
  call with no per-item detail request. Incremental by paging newest-first and
  stopping at the watermark (initial run bounded by the `j` = last-N-days filter).

Run all sources or a subset:

```bash
npm run crawl                       # all
npm run crawl -- camptocamp         # one
npm run crawl -- powderguide skitour
```

## Scheduling the crawler

The crawler is a plain Node script that exits when done. Schedule it with cron:

```cron
# every 30 minutes
*/30 * * * * cd /path/to/Alpica && /usr/bin/node crawler/src/index.js >> logs/crawler.log 2>&1
```

or with a macOS `launchd` plist / systemd timer on Linux.
