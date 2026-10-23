import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { publishUi } from "./publish.ts";
import { readUiBuild } from "../../server/http/assets/ui-build.ts";

test("UI publication is deterministic, preserves the previous entry and rolls back failed publication", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-ui-publish-"));
  const destination = join(root, "dist");
  let counter = 0;
  const stage = (script: string) => {
    const path = join(root, `stage-${counter++}`);
    mkdirSync(path);
    writeFileSync(join(path, "index.html"), '<html><head></head><body><script src="./index.js"></script></body></html>');
    writeFileSync(join(path, "index.js"), script);
    writeFileSync(join(path, "style.css"), "body{}");
    return path;
  };
  try {
    const first = publishUi(stage("first"), destination);
    expect(publishUi(stage("first"), destination)).toBe(first);
    expect(readUiBuild(join(destination, "index.html"))).toBe(first);
    const second = publishUi(stage("second"), destination);
    expect(second).not.toBe(first);
    expect(readFileSync(join(destination, `index-${first}.js`), "utf8")).toBe("first");
    expect(publishUi(stage("second"), destination)).toBe(second);
    expect(readFileSync(join(destination, `index-${first}.js`), "utf8")).toBe("first");
    const before = readFileSync(join(destination, "index.html"), "utf8");
    const failed = stage("failed");
    writeFileSync(join(failed, "a.css"), "new");
    writeFileSync(join(failed, "b.css"), "blocked");
    mkdirSync(join(destination, "b.css"));
    expect(() => publishUi(failed, destination)).toThrow();
    expect(readFileSync(join(destination, "index.html"), "utf8")).toBe(before);
    expect(readdirSync(destination)).not.toContain("a.css");
    const third = publishUi(stage("third"), destination);
    expect(readdirSync(destination)).not.toContain(`index-${first}.js`);
    expect(readUiBuild(join(destination, "index.html"))).toBe(third);
    const invalid = stage("invalid");
    rmSync(join(invalid, "index.js"));
    expect(() => publishUi(invalid, destination)).toThrow("missing");
    expect(readUiBuild(join(destination, "index.html"))).toBe(third);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
