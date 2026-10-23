import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { reconcileMathRenderer } from "./math-renderer.ts";

test("incremental installs remove only the stale nested renderer", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-math-install-"));
  const nested = join(root, "node_modules/mermaid/node_modules/katex");
  const write = (path: string, value: unknown) => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value));
  };
  try {
    write("package.json", { dependencies: { katex: "^0.19.0" }, overrides: { katex: "^0.19.0" } });
    write("node_modules/katex/package.json", { name: "katex", version: "0.19.0" });
    write("node_modules/mermaid/node_modules/marked/package.json", { name: "marked" });
    write("node_modules/mermaid/node_modules/katex/package.json", { name: "katex", version: "0.16.47" });
    reconcileMathRenderer(root);
    expect(existsSync(nested)).toBe(false);
    expect(existsSync(join(root, "node_modules/katex/package.json"))).toBe(true);
    expect(existsSync(join(root, "node_modules/mermaid/node_modules/marked/package.json"))).toBe(true);
    reconcileMathRenderer(root);
    write("node_modules/mermaid/node_modules/katex/package.json", { name: "katex", version: "0.19.0" });
    reconcileMathRenderer(root);
    expect(existsSync(nested)).toBe(true);
    write("node_modules/mermaid/node_modules/katex/package.json", { name: "unexpected", version: "0.16.47" });
    expect(() => reconcileMathRenderer(root)).toThrow("do not match");
    expect(JSON.parse(readFileSync(join(nested, "package.json"), "utf8")).name).toBe("unexpected");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
