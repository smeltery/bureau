import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { DiffFileSummary } from "../shared/types.ts";
import { synthesizeUntrackedPatches } from "./bureau-diff-untracked.ts";

let tmp: string | null = null;

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = null;
});

describe("synthesizeUntrackedPatches", () => {
  test("adds textual untracked files to the patch and file summary", () => {
    tmp = mkdtempSync(join(tmpdir(), "bureau-diff-"));
    writeFileSync(join(tmp, "note.txt"), "one\ntwo\n");
    const fileMap = new Map<string, DiffFileSummary>();

    const patches = synthesizeUntrackedPatches(tmp, ["note.txt"], fileMap);

    expect(patches).toHaveLength(1);
    expect(patches[0]).toContain("diff --git a/note.txt b/note.txt");
    expect(patches[0]).toContain("+one\n+two");
    expect(fileMap.get("note.txt")).toMatchObject({ status: "added", additions: 2, deletions: 0, lineCount: 2 });
  });

  test("marks binary untracked files without synthesizing a patch", () => {
    tmp = mkdtempSync(join(tmpdir(), "bureau-diff-"));
    writeFileSync(join(tmp, "image.bin"), Buffer.from([0, 1, 2]));
    const fileMap = new Map<string, DiffFileSummary>();

    const patches = synthesizeUntrackedPatches(tmp, ["image.bin"], fileMap);

    expect(patches).toEqual([]);
    expect(fileMap.get("image.bin")).toMatchObject({ status: "binary", additions: 0, deletions: 0, lineCount: 0 });
  });
});
