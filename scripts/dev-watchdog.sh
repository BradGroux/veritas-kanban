#!/usr/bin/env bash
set -euo pipefail

# Simple dev watchdog:
# - polls http://localhost:${PORT}/api/health
# - if unhealthy for N consecutive checks, runs `pnpm dev:clean`
#
# Intended for macOS launchd or manual terminal use.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3001}"
INTERVAL_SECONDS="${WATCHDOG_INTERVAL_SECONDS:-30}"
FAIL_THRESHOLD="${WATCHDOG_FAIL_THRESHOLD:-3}"

URL="http://localhost:${PORT}/api/health"

fails=0

echo "[dev-watchdog] repo=${REPO_ROOT}"
echo "[dev-watchdog] url=${URL} interval=${INTERVAL_SECONDS}s threshold=${FAIL_THRESHOLD}"

while true; do
  http_code="$(curl -s -o /dev/null -w '%{http_code}' "${URL}" || true)"

  if [[ "${http_code}" == "200" ]]; then
    fails=0
  else
    fails=$((fails+1))
    echo "[dev-watchdog] health check failed (http=${http_code}) fails=${fails}/${FAIL_THRESHOLD}"
  fi

  if [[ "${fails}" -ge "${FAIL_THRESHOLD}" ]]; then
    echo "[dev-watchdog] unhealthy threshold reached -> restarting via pnpm dev:clean"
    cd "${REPO_ROOT}"
    exec pnpm dev:clean
  fi

  sleep "${INTERVAL_SECONDS}"
done
