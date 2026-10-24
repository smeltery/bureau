import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readOrCreateOfficeId } from "./office-id.ts";

test("office identity is durable, private and distinct between state roots", () => {
  const dir = mkdtempSync(join(tmpdir(), "bureau-office-id-"));
  try {
    const path = join(dir, "office-id");
    const id = readOrCreateOfficeId(path);
    expect(id).toMatch(/^[a-f0-9]{12}$/);
    expect(readOrCreateOfficeId(path)).toBe(id);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readOrCreateOfficeId(join(dir, "other"))).not.toBe(id);
    writeFileSync(join(dir, "restored"), readFileSync(path));
    expect(readOrCreateOfficeId(join(dir, "restored"))).toBe(id);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("invalid identities are preserved and I/O errors refuse an ephemeral identity", () => {
  const dir = mkdtempSync(join(tmpdir(), "bureau-office-id-"));
  try {
    const path = join(dir, "office-id");
    writeFileSync(path, "broken\n");
    expect(readOrCreateOfficeId(path)).toMatch(/^[a-f0-9]{12}$/);
    const aside = readdirSync(dir).find((name) => name.startsWith("office-id.invalid-"))!;
    expect(readFileSync(join(dir, aside), "utf8")).toBe("broken\n");
    mkdirSync(join(dir, "directory"));
    expect(() => readOrCreateOfficeId(join(dir, "directory"))).toThrow();
    expect(() => readOrCreateOfficeId(join(dir, "missing", "id"))).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
