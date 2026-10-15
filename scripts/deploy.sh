#!/usr/bin/env bash
#
# Deploy / update script for the Alpica stack on the nine.ch managed server.
#
# Run this AFTER `git pull` to bring the running deployment up to date:
#   cd /home/www-data/alpica && git pull && ./scripts/deploy.sh
#
# What it does, in order:
#   1. install workspace deps (api, crawler, db)
#   2. install web deps
#   3. run DB migrations (idempotent — already-applied ones are skipped)
#   4. build the Angular SSR bundle
#   5. reload the pm2 processes (zero-downtime) and persist the process list
#
# Flags:
#   --skip-migrate   don't run DB migrations (e.g. web-only change)
#   --skip-build     don't rebuild the web bundle (e.g. backend-only change)
#   --restart        hard `pm2 restart` instead of `pm2 reload`
#
# The script aborts on the first error (set -e) so a failed step never leaves
# a half-updated deployment serving traffic.

set -euo pipefail

# --- Flags ------------------------------------------------------------------
SKIP_MIGRATE=0
SKIP_BUILD=0
PM2_ACTION="reload"
for arg in "$@"; do
  case "$arg" in
    --skip-migrate) SKIP_MIGRATE=1 ;;
    --skip-build)   SKIP_BUILD=1 ;;
    --restart)      PM2_ACTION="restart" ;;
    *) echo "[deploy] unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# --- Paths ------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ECOSYSTEM="${ROOT_DIR}/ecosystem.config.cjs"

log() { printf '[deploy] %s %s\n' "$(date -Is)" "$*"; }

cd "${ROOT_DIR}"

# --- Preflight: node + pm2 must be on PATH ---------------------------------
command -v node >/dev/null || { log "ERROR: node not on PATH"; exit 1; }
command -v pm2  >/dev/null || { log "ERROR: pm2 not on PATH (npm install -g pm2?)"; exit 1; }
log "using node $(node -v), pm2 $(pm2 -v)"

# --- 1. Install workspace deps (api, crawler, db) --------------------------
# `npm ci` is reproducible and matches package-lock.json exactly. Falls back to
# `npm install` if there is no lockfile (shouldn't happen in this repo).
log "installing workspace dependencies"
if [ -f "${ROOT_DIR}/package-lock.json" ]; then
  npm ci
else
  npm install
fi

# --- 2. Install web deps ----------------------------------------------------
log "installing web dependencies"
if [ -f "${ROOT_DIR}/web/package-lock.json" ]; then
  npm ci --prefix web
else
  npm install --prefix web
fi

# --- 3. DB migrations (idempotent) -----------------------------------------
if [ "${SKIP_MIGRATE}" -eq 0 ]; then
  log "running database migrations"
  npm run migrate
else
  log "skipping migrations (--skip-migrate)"
fi

# --- 4. Build the Angular SSR bundle ---------------------------------------
if [ "${SKIP_BUILD}" -eq 0 ]; then
  log "building web (SSR) bundle"
  npm run build --prefix web
else
  log "skipping web build (--skip-build)"
fi

# --- 5. Reload pm2 processes ------------------------------------------------
# `pm2 reload` restarts workers one by one (zero-downtime); `--restart` does a
# hard restart. If the processes aren't registered yet (first deploy), start
# them from the ecosystem file instead.
if pm2 describe alpica-web >/dev/null 2>&1; then
  log "pm2 ${PM2_ACTION} (alpica-api, alpica-web)"
  pm2 "${PM2_ACTION}" alpica-api alpica-web
else
  log "pm2 processes not found — starting from ${ECOSYSTEM}"
  pm2 start "${ECOSYSTEM}"
fi

# Persist the current process list so systemd's `pm2 resurrect` restores it
# after a reboot.
pm2 save

log "deploy complete"
pm2 ls
