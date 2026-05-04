#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
QMD_BIN="${QMD_BIN:-qmd}"
SKIP_EMBED="${VERITAS_QMD_SKIP_EMBED:-false}"

if ! command -v "$QMD_BIN" >/dev/null 2>&1; then
  echo "qmd CLI not found. Install with: npm install -g @tobilu/qmd" >&2
  exit 1
fi

cd "$ROOT_DIR"
"$QMD_BIN" update

if [[ "$SKIP_EMBED" != "true" ]]; then
  "$QMD_BIN" embed
fi
