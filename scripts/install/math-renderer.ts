import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

export function reconcileMathRenderer(root: string): void {
  const nested = resolve(root, "node_modules/mermaid/node_modules/katex");
  if (!existsSync(nested)) return;
  const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const override = manifest.overrides?.katex;
  const installed = JSON.parse(readFileSync(resolve(root, "node_modules/katex/package.json"), "utf8"));
  const previous = JSON.parse(readFileSync(resolve(nested, "package.json"), "utf8"));
  if (typeof override !== "string" || override !== manifest.dependencies?.katex || installed.name !== "katex" || !Bun.semver.satisfies(installed.version, override) || previous.name !== "katex") {
    throw new Error("Cannot reconcile math renderers: the installed packages do not match the KaTeX override.");
  }
  if (previous.version === installed.version) return;
  // Bun can retain this formerly locked nested dependency on incremental
  // installs. Removing only that obsolete package lets Mermaid use the override.
  rmSync(nested, { recursive: true });
  console.log("Removed obsolete nested math renderer.");
}

if (import.meta.main) reconcileMathRenderer(resolve(import.meta.dir, "../.."));
