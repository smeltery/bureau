#!/usr/bin/env bash
set -euo pipefail

cleanup() {
  kill 0 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Ensure dist has HTML/CSS/PWA assets before watchers start.
bash scripts/build.sh

# Rebuild frontend bundle on TS/TSX changes.
bun build ui/index.tsx --outdir ui/dist --production --watch &

# Restart server automatically on backend/shared changes.
BUREAU_LIVE_RELOAD=1 bun --watch server/index.ts &

wait
