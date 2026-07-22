import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, renameSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { openFile, saveFile, stopWatch, watchFile, type FileWatcher } from "./file-editor.ts";

const tempDirs: string[] = [];
const watchers: FileWatcher[] = [];

afterEach(() => {
  while (watchers.length) stopWatch(watchers.pop()!);
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe("watchFile", () => {
  test("emits for atomic rename-replace saves", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bureau-editor-"));
    tempDirs.push(dir);
    const path = join(dir, "notes.txt");
    writeFileSync(path, "before", "utf8");
    const opened = openFile(path);
    expect(opened.kind).toBe("ok");
    if (opened.kind !== "ok") return;

    const seen = new Promise((resolve) => {
      watchers.push(watchFile(path, "agent-1", resolve, opened.sig));
    });
    const tmp = join(dir, "notes.txt.tmp");
    writeFileSync(tmp, "after", "utf8");
    renameSync(tmp, path);

    await expect(seen).resolves.toMatchObject({ kind: "change" });
  });

  test("uses read-time signature as the first poll baseline", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bureau-editor-"));
    tempDirs.push(dir);
    const path = join(dir, "notes.txt");
    writeFileSync(path, "before", "utf8");
    const opened = openFile(path);
    expect(opened.kind).toBe("ok");
    if (opened.kind !== "ok") return;

    const tmp = join(dir, "notes.txt.tmp");
    writeFileSync(tmp, "after", "utf8");
    renameSync(tmp, path);

    const seen = new Promise((resolve) => {
      watchers.push(watchFile(path, "agent-1", resolve, opened.sig));
    });

    await expect(seen).resolves.toMatchObject({ kind: "change" });
  });

  test("emits a deletion event after the watched file stays missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bureau-editor-"));
    tempDirs.push(dir);
    const path = join(dir, "notes.txt");
    writeFileSync(path, "before", "utf8");
    const opened = openFile(path);
    expect(opened.kind).toBe("ok");
    if (opened.kind !== "ok") return;

    const seen = new Promise((resolve) => {
      watchers.push(watchFile(path, "agent-1", resolve, opened.sig));
    });
    unlinkSync(path);

    await expect(seen).resolves.toEqual({ kind: "deleted" });
  });
});

describe("saveFile", () => {
  test("rejects stale saves when disk mtime moves backwards", () => {
    const dir = mkdtempSync(join(tmpdir(), "bureau-editor-"));
    tempDirs.push(dir);
    const path = join(dir, "notes.txt");
    writeFileSync(path, "before", "utf8");
    const opened = openFile(path);
    expect(opened.kind).toBe("ok");
    if (opened.kind !== "ok") return;

    writeFileSync(path, "changed", "utf8");
    utimesSync(path, new Date(0), new Date(0));

    const saved = saveFile(path, "overwrite", opened.mtime, false, opened.rev);

    expect(saved).toMatchObject({ kind: "stale", path });
  });

  test("returns a bumped revision after a successful save", () => {
    const dir = mkdtempSync(join(tmpdir(), "bureau-editor-"));
    tempDirs.push(dir);
    const path = join(dir, "notes.txt");
    writeFileSync(path, "before", "utf8");
    const opened = openFile(path);
    expect(opened.kind).toBe("ok");
    if (opened.kind !== "ok") return;

    const saved = saveFile(path, "after with a longer body", opened.mtime, false, opened.rev);

    expect(saved.kind).toBe("ok");
    if (saved.kind !== "ok") return;
    expect(saved.rev).toBeGreaterThan(opened.rev);
  });
});
