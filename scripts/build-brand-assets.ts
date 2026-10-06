// Regenerates every logo asset from website/src/brand-mark.ts.
// Run: bun scripts/build-brand-assets.ts   (needs rsvg-convert on PATH)
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { maskableIconSvg, officeMarkSvg } from "../website/src/brand-mark.ts";

const root = resolve(import.meta.dir, "..");
const at = (p: string) => resolve(root, p);
const write = (p: string, svg: string) => writeFileSync(at(p), `${svg}\n`);

const simple = officeMarkSvg(false);
const detailed = officeMarkSvg(true);
const maskable = maskableIconSvg();

write("website/public/favicon.svg", simple);
write("website/public/logo.svg", detailed);
write("ui/icon.svg", detailed);
write("ui/icon-maskable.svg", maskable);

function rasterize(svgPath: string, size: number, out: string) {
  const r = Bun.spawnSync(["rsvg-convert", "-w", String(size), "-h", String(size), at(svgPath), "-o", at(out)]);
  if (r.exitCode !== 0) throw new Error(`rsvg-convert failed for ${out}: ${r.stderr.toString()}`);
}
rasterize("ui/icon.svg", 180, "ui/icons/icon-180.png");
rasterize("ui/icon.svg", 192, "ui/icons/icon-192.png");
rasterize("ui/icon.svg", 512, "ui/icons/icon-512.png");
rasterize("ui/icon-maskable.svg", 512, "ui/icons/icon-512-maskable.png");

// The app's attention badge splices a circle into this data URI on a 32×32
// grid (ui/notifications.ts), so the simple cut keeps that frame.
const dataUri = `data:image/svg+xml,${simple.replaceAll("#", "%23")}`;
for (const page of ["ui/index.html", "demo/index.html"]) {
  const html = readFileSync(at(page), "utf8");
  const favicon = /<link rel="icon" href="data:image\/svg\+xml,[^"]*" \/>/;
  if (!favicon.test(html)) throw new Error(`no inline favicon found in ${page}`);
  writeFileSync(at(page), html.replace(favicon, `<link rel="icon" href="${dataUri}" />`));
}
