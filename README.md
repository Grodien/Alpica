# Alpica

Aggregates mountain conditions reports from external APIs into a normalized data
store, exposes them through a protected API, and presents them on a server-side
rendered Angular website.

## Components

| Component | Path | Description |
|-----------|------|-------------|
| **db**      | `db`      | Shared MySQL connection pool + SQL migrations. |
| **crawler** | `crawler` | Scheduled Node.js scripts that pull data from source APIs (PowderGuide, Camptocamp) and store it raw + normalized. |
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
cp ../.env .env   # provides API_BASE_URL, API_KEY and PORT to the SSR server
npm run build && npm run serve:ssr
```

The website has **no browser-facing API endpoint at all**. Searching is a normal
navigation (`/?q=...`): the search form is a native GET form, so submitting it
triggers a full page load. During server-side rendering a route resolver fetches
the results from the internal API (with the `x-api-key` header) and the server
returns finished HTML with the results already in it. The browser receives only
rendered HTML — never JSON, and the API key, API URL and fetch code are not even
present in the client bundle (the search backend is a server-only DI provider).

## Security posture

- **The API is not reachable from outside the host.** It binds to `127.0.0.1`
  by default (`API_HOST`), so only the co-located web SSR server talks to it.
  Do not set `API_HOST=0.0.0.0` unless you deliberately want to expose it.
- The API key is required on every API request (`x-api-key` header) and only its
  SHA-256 hash is stored in `api_keys`.
- The browser never sees the API key or the API URL — the SSR proxy adds them
  server-side.
- The SSR server enforces a Host-header allowlist via `NG_ALLOWED_HOSTS`
  (protects against host-header / DNS-rebinding attacks). Set it to your real
  domain(s) in production.

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

Run all sources or a subset:

```bash
npm run crawl                       # all
npm run crawl -- camptocamp         # one
npm run crawl -- powderguide camptocamp
```

## Scheduling the crawler

The crawler is a plain Node script that exits when done. Schedule it with cron:

```cron
# every 30 minutes
*/30 * * * * cd /path/to/Alpica && /usr/bin/node crawler/src/index.js >> logs/crawler.log 2>&1
```

or with a macOS `launchd` plist / systemd timer on Linux.
