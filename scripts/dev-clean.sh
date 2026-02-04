#!/usr/bin/env bash
set -euo pipefail

# Dev safety rail: kill stale VK dev runners + free ports, then restart.
#
# Goals:
# - Prevent “port capture” (something else bound to :3001 / :3000)
# - Prevent duplicate watchers (tsx watch / vite / concurrently)
# - Be SAFE: only target this repo’s processes + the configured ports

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SERVER_PORT="${PORT:-3001}"
WEB_PORT="${WEB_PORT:-3000}"

echo "[dev-clean] repo=${REPO_ROOT}"
echo "[dev-clean] ports: server=${SERVER_PORT} web=${WEB_PORT}"

kill_listeners() {
  local port="$1"
  local pids
  pids="$(lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null || true)"
  if [[ -n "${pids}" ]]; then
    echo "[dev-clean] killing listeners on :${port}: ${pids}"
    # shellcheck disable=SC2086
    kill ${pids} 2>/dev/null || true
  fi
}

kill_repo_watchers() {
  python3 - <<PY
import os, re, subprocess
repo=os.environ['REPO_ROOT']
pat=re.compile(r'(pnpm\s+dev|concurrently|vite(\.js)?(\s|$)|tsx\s+watch)')
ps=subprocess.check_output(['ps','aux'], text=True).splitlines()[1:]
kill=[]
for line in ps:
    if repo not in line:
        continue
    if not pat.search(line):
        continue
    try:
        pid=int(line.split()[1])
    except Exception:
        continue
    # Don't kill the current python process
    if pid == os.getpid():
        continue
    kill.append(pid)
if kill:
    print('[dev-clean] killing repo dev watchers:', kill)
    for pid in kill:
        try:
            os.kill(pid, 15)
        except ProcessLookupError:
            pass
else:
    print('[dev-clean] no repo dev watchers found')
PY
}

export REPO_ROOT

kill_listeners "${SERVER_PORT}"
kill_listeners "${WEB_PORT}"

# Give sockets a moment to release
sleep 0.5

kill_repo_watchers

sleep 0.5

echo "[dev-clean] starting pnpm dev"
cd "${REPO_ROOT}"
exec pnpm dev
