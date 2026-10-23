import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalProviderDirectory, createProviderHomes } from "./homes.ts";
test("managed homes activate explicitly, persist privately and refuse symlinked directories", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-provider-home-"));
  const homes = createProviderHomes(root);
  try {
    expect(homes.active("member", "codex")).toBe(false);
    const path = homes.ensure("member", "codex");
    expect(statSync(path).mode & 0o777).toBe(0o700);
    expect(homes.active("member", "codex")).toBe(false);
    homes.setActive("member", "codex", true);
    expect(createProviderHomes(root).active("member", "codex")).toBe(true);
    expect(statSync(join(path, ".bureau-active")).mode & 0o777).toBe(0o600);
    homes.setActive("member", "codex", false);
    expect(homes.active("member", "codex")).toBe(false);
    expect(() => homes.ensure("../escape", "claude")).toThrow();
    mkdirSync(join(root, "external"));
    symlinkSync(join(root, "external"), homes.home("member", "claude"));
    expect(() => homes.ensure("member", "claude")).toThrow("private directory");
    writeFileSync(join(path, ".bureau-active"), "broken");
    expect(() => homes.active("member", "codex")).toThrow("Invalid");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("canonical account paths resolve existing ancestors without creating directories", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-provider-canonical-"));
  try {
    mkdirSync(join(root, "real"));
    symlinkSync(join(root, "real"), join(root, "alias"));
    expect(canonicalProviderDirectory(join(root, "alias", "future"))).toBe(join(canonicalProviderDirectory(root), "real", "future"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
