#!/usr/bin/env bash
set -euo pipefail

# Build main app.
mkdir -p ui
if ! mkdir ui/.build-lock 2>/dev/null; then
  echo "Another UI build holds ui/.build-lock; wait for it to finish." >&2
  exit 1
fi
UI_STAGE=""
trap 'if [[ -n "$UI_STAGE" ]]; then rm -rf "$UI_STAGE"; fi; rmdir ui/.build-lock' EXIT
UI_STAGE=$(mktemp -d ui/.build-stage.XXXXXX)

#
# Bun's bundler lists every produced chunk by default — useful for size
# debugging, noise the rest of the time. Filter out the per-chunk lines
# (`  name.js   12.34 KB  (chunk)`) so a clean build shows just the
# "Bundled N modules" summary and the entry-point line. Anything that
# doesn't match the chunk shape (errors, warnings, blank lines) passes
# through. Set BUREAU_BUILD_VERBOSE=1 to skip the filter when debugging.
if [[ "${BUREAU_BUILD_VERBOSE:-}" == "1" ]]; then
  bun build ui/index.tsx --outdir "$UI_STAGE" --production
else
  bun build ui/index.tsx --outdir "$UI_STAGE" --production 2>&1 \
    | awk '!/^[[:space:]]+[^[:space:]]+\.(js|css)[[:space:]]+[0-9.]+[[:space:]]+(KB|MB|bytes)[[:space:]]+\(chunk\)[[:space:]]*$/'
fi
cp ui/index.html "$UI_STAGE"/index.html
cp node_modules/@xterm/xterm/css/xterm.css "$UI_STAGE"/xterm.css
cp node_modules/diff2html/bundles/css/diff2html.min.css "$UI_STAGE"/diff2html.css
rm -rf "$UI_STAGE"/katex
mkdir -p "$UI_STAGE"/katex/fonts
cp node_modules/katex/dist/katex.min.css "$UI_STAGE"/katex/katex.min.css
cp node_modules/katex/dist/fonts/* "$UI_STAGE"/katex/fonts/

# PWA assets
cp ui/sw.js "$UI_STAGE"/sw.js
cp ui/manifest.json "$UI_STAGE"/manifest.json
mkdir -p "$UI_STAGE"/icons
cp ui/icons/*.png "$UI_STAGE"/icons/
cp ui/icon.svg "$UI_STAGE"/icons/icon.svg

bun run scripts/build-browser-extension.ts "$UI_STAGE"
bun run scripts/license-notices.mjs "$UI_STAGE"

bun run scripts/ui-build/publish.ts "$UI_STAGE" ui/dist
