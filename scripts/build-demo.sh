#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${BUREAU_SKIP_APP_BUILD:-}" != "1" ]]; then
  bash "$ROOT_DIR/scripts/build.sh"
fi
mkdir -p "$ROOT_DIR/demo/dist"
bun build "$ROOT_DIR/demo/demo-entry.tsx" --outdir "$ROOT_DIR/demo/dist" --production
cp "$ROOT_DIR/demo/index.html" "$ROOT_DIR/demo/dist/index.html"
cp "$ROOT_DIR/node_modules/@xterm/xterm/css/xterm.css" "$ROOT_DIR/demo/dist/xterm.css"
