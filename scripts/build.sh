#!/usr/bin/env bash
set -euo pipefail

# Build main app.
#
# Bun's bundler lists every produced chunk by default — useful for size
# debugging, noise the rest of the time. Filter out the per-chunk lines
# (`  name.js   12.34 KB  (chunk)`) so a clean build shows just the
# "Bundled N modules" summary and the entry-point line. Anything that
# doesn't match the chunk shape (errors, warnings, blank lines) passes
# through. Set BUREAU_BUILD_VERBOSE=1 to skip the filter when debugging.
if [[ "${BUREAU_BUILD_VERBOSE:-}" == "1" ]]; then
  bun build ui/index.tsx --outdir ui/dist --production
else
  bun build ui/index.tsx --outdir ui/dist --production 2>&1 \
    | awk '!/^[[:space:]]+[^[:space:]]+\.(js|css)[[:space:]]+[0-9.]+[[:space:]]+(KB|MB|bytes)[[:space:]]+\(chunk\)[[:space:]]*$/'
fi
cp ui/index.html ui/dist/index.html
cp node_modules/@xterm/xterm/css/xterm.css ui/dist/xterm.css
cp node_modules/diff2html/bundles/css/diff2html.min.css ui/dist/diff2html.css
rm -rf ui/dist/katex
mkdir -p ui/dist/katex/fonts
cp node_modules/katex/dist/katex.min.css ui/dist/katex/katex.min.css
cp node_modules/katex/dist/fonts/* ui/dist/katex/fonts/

# PWA assets
cp ui/sw.js ui/dist/sw.js
cp ui/manifest.json ui/dist/manifest.json
mkdir -p ui/dist/icons
cp ui/icons/*.png ui/dist/icons/
cp ui/icon.svg ui/dist/icons/icon.svg

bun run scripts/build-browser-extension.ts
bun run scripts/license-notices.mjs ui/dist
