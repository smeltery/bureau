import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { publishUi } from "./publish.ts";

test("published split bundles retain valid deferred imports back to their named entry", async () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-split-build-"));
  try {
    const source = join(root, "source"),
      stage = join(root, "stage"),
      destination = join(root, "dist");
    mkdirSync(source);
    writeFileSync(join(source, "index.ts"), 'export const label = "loaded"; export const load = async () => (await import("./view.ts")).render();');
    writeFileSync(join(source, "view.ts"), 'import { label } from "./index.ts"; export const render = () => label;');
    const result = await Bun.build({
      entrypoints: [join(source, "index.ts")],
      outdir: stage,
      target: "browser",
      splitting: true,
      naming: { entry: "entry-[hash].[ext]", chunk: "chunk-[hash].[ext]" },
    });
    expect(result.success).toBe(true);
    writeFileSync(join(stage, "index.html"), '<html><head></head><script src="./index.js"></script></html>');
    publishUi(stage, destination);
    const entry = /src="\.\/([^"]+)"/.exec(readFileSync(join(destination, "index.html"), "utf8"))![1];
    expect(entry).toStartWith("entry-");
    const module = await import(pathToFileURL(join(destination, entry)).href);
    expect(await module.load()).toBe("loaded");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
