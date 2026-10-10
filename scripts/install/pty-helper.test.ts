import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { preparePtyHelper } from "./pty-helper.ts";

test("repairs packaged macOS helpers idempotently without changing Linux files", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-pty-install-"));
  try {
    const dir = join(root, "prebuilds/darwin-arm64");
    mkdirSync(dir, { recursive: true });
    const helper = join(dir, "spawn-helper");
    writeFileSync(helper, "fixture");
    chmodSync(helper, 0o644);
    preparePtyHelper(root, "linux", "arm64");
    expect(statSync(helper).mode & 0o777).toBe(0o644);
    preparePtyHelper(root, "darwin", "arm64");
    expect(statSync(helper).mode & 0o777).toBe(0o755);
    preparePtyHelper(root, "darwin", "arm64");
    expect(statSync(helper).mode & 0o777).toBe(0o755);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
