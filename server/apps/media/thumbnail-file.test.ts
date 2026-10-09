import { afterAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readThumbnailFile } from "./thumbnail-file.ts";

const root = mkdtempSync(join(tmpdir(), "bureau-thumbnail-file-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("reads regular files and refuses oversized or special files", () => {
  const image = join(root, "image.png");
  writeFileSync(image, "sample");
  expect(readThumbnailFile(image).toString()).toBe("sample");
  writeFileSync(image, Buffer.alloc(1024 * 1024 + 1));
  expect(() => readThumbnailFile(image)).toThrow("regular file");
  expect(() => readThumbnailFile(root)).toThrow("regular file");
  expect(() => readThumbnailFile(join(root, "missing"))).toThrow("regular file");
  const pipe = join(root, "fifo.png");
  execFileSync("mkfifo", [pipe]);
  const started = Date.now();
  expect(() => readThumbnailFile(pipe)).toThrow("regular file");
  expect(Date.now() - started).toBeLessThan(1000);
});

test("refuses sensitive names and symlinks to protected targets without echoing paths", () => {
  const secret = join(root, ".env.private");
  const alias = join(root, "alias.png");
  writeFileSync(secret, "secret");
  symlinkSync(secret, alias);
  for (const path of [secret, alias]) {
    try {
      readThumbnailFile(path);
      throw new Error("unexpected success");
    } catch (error) {
      expect((error as Error).message).toContain("non-sensitive");
      expect((error as Error).message).not.toContain(root);
    }
  }
});
