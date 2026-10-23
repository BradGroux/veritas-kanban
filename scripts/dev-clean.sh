#!/usr/bin/env bash
set -euo pipefail

# Dev safety rail: stop verified checkout dev runners, then restart.
#
# Goals:
# - Prevent “port capture” (something else bound to :3001 / :3000)
# - Prevent duplicate watchers (tsx watch / vite / concurrently)
# - Refuse foreign listeners; verify checkout and process identity before signals

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# launchd sessions often have a minimal PATH; resolve pnpm explicitly.
PNPM_BIN="$(command -v pnpm || true)"
if [[ -z "${PNPM_BIN}" && -x "/opt/homebrew/bin/pnpm" ]]; then
  PNPM_BIN="/opt/homebrew/bin/pnpm"
fi
if [[ -z "${PNPM_BIN}" ]]; then
  echo "[dev-clean] ERROR: pnpm not found in PATH and /opt/homebrew/bin/pnpm missing" >&2
  exit 1
fi

SERVER_PORT="${PORT:-3001}"
WEB_PORT="${WEB_PORT:-3000}"

echo "[dev-clean] repo=${REPO_ROOT}"
echo "[dev-clean] ports: server=${SERVER_PORT} web=${WEB_PORT}"

# Verify every listener before any signal, then recheck each exact process identity.
# The shared helper also protects the watchdog's recovery path.
node "${REPO_ROOT}/scripts/dev-process-ownership.mjs" "${SERVER_PORT}" "${WEB_PORT}"

# Give verified runners a moment to release their sockets; never kill by port.
sleep 1

echo "[dev-clean] starting pnpm dev"
cd "${REPO_ROOT}"
exec "${PNPM_BIN}" dev
