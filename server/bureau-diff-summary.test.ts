import { describe, expect, test } from "bun:test";
import type { DiffFileSummary } from "../shared/types.ts";
import { applyNameStatus, applyNumstat, extractPostImagePath } from "./bureau-diff-summary.ts";

describe("bureau diff summary helpers", () => {
  test("extractPostImagePath handles git rename formats", () => {
    expect(extractPostImagePath("src/{old => new}/file.ts")).toBe("src/new/file.ts");
    expect(extractPostImagePath("old/path.ts => new/path.ts")).toBe("new/path.ts");
    expect(extractPostImagePath("plain.ts")).toBe("plain.ts");
  });

  test("merges name-status and numstat rows by post-image path", () => {
    const fileMap = new Map<string, DiffFileSummary>();

    applyNameStatus(fileMap, "R100\tsrc/old.ts\tsrc/new.ts\nC100\tsrc/base.ts\tsrc/copy.ts");
    applyNumstat(fileMap, "3\t1\tsrc/{old.ts => new.ts}\n2\t0\tsrc/{base.ts => copy.ts}");

    expect(fileMap.get("src/new.ts")).toMatchObject({ oldPath: "src/old.ts", status: "renamed", additions: 3, deletions: 1, lineCount: 4 });
    expect(fileMap.get("src/copy.ts")).toMatchObject({ oldPath: "src/base.ts", status: "copied", additions: 2, deletions: 0, lineCount: 2 });
  });

  test("marks binary numstat rows", () => {
    const fileMap = new Map<string, DiffFileSummary>();

    applyNumstat(fileMap, "-\t-\timage.png");

    expect(fileMap.get("image.png")).toMatchObject({ status: "binary", additions: 0, deletions: 0, lineCount: 0 });
  });
});
