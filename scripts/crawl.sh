#!/usr/bin/env bash
#
# Crawler wrapper for cron on the nine.ch managed server.
#
# cron runs with a minimal environment and does NOT know about nvm, so this
# script loads nvm, selects the project's Node version (.nvmrc), and runs the
# crawler with the root .env injected (the crawler itself does not load .env).
#
# crontab example (every 30 minutes):
#   */30 * * * * /home/www-data/alpica/scripts/crawl.sh >> /home/www-data/alpica/logs/crawler.log 2>&1
#
# Optionally pass specific sources (defaults to all):
#   crawl.sh camptocamp
#   crawl.sh powderguide skitour

set -euo pipefail

# Resolve the repo root from this script's location, so the script works no
# matter what cron's working directory is.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

# Prefix every output line (from this script AND the crawler process) with an
# ISO-8601 timestamp, so the combined log stays readable. `date` per line is a
# subprocess, but at crawler volumes that cost is negligible; it keeps the log
# uniform without touching the crawler's own console.log calls.
timestamp() {
  while IFS= read -r line; do
    printf '%s %s\n' "$(date -Is)" "${line}"
  done
}

# --- Load nvm (cron doesn't source .bashrc) --------------------------------
export NVM_DIR="${NVM_DIR:-${HOME}/.nvm}"
if [ -s "${NVM_DIR}/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "${NVM_DIR}/nvm.sh"
else
  echo "[crawl] nvm not found at ${NVM_DIR}/nvm.sh" | timestamp >&2
  exit 1
fi

# Use the version pinned in .nvmrc if present, else the default alias.
if [ -f "${ROOT_DIR}/.nvmrc" ]; then
  nvm use --silent "$(cat "${ROOT_DIR}/.nvmrc")" >/dev/null 2>&1 || nvm use --silent default >/dev/null 2>&1 || true
else
  nvm use --silent default >/dev/null 2>&1 || true
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[crawl] node not available after loading nvm" | timestamp >&2
  exit 1
fi

if [ ! -f "${ENV_FILE}" ]; then
  echo "[crawl] env file not found: ${ENV_FILE}" | timestamp >&2
  exit 1
fi

# --- Run the crawler --------------------------------------------------------
# --env-file loads the shared root .env (DB creds, source config, etc.).
# Any args passed to this script are forwarded as source names.
#
# Every line (banner + crawler stdout/stderr) is piped through timestamp() so
# the whole log is uniformly time-prefixed. To preserve the crawler's real exit
# code across the pipe, we enable `pipefail` and read PIPESTATUS[0] (the node
# process), not the pipe's last command (timestamp, which always succeeds).
cd "${ROOT_DIR}"

echo "[crawl] starting (node $(node -v), sources: ${*:-all})" | timestamp

set +e
node --env-file="${ENV_FILE}" crawler/src/index.js "$@" 2>&1 | timestamp
status="${PIPESTATUS[0]}"
set -e

echo "[crawl] finished with exit code ${status}" | timestamp
exit "${status}"
