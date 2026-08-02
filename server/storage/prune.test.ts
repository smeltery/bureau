import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { applyPrune, planPrune, type PruneDeps } from "./prune.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

describe("storage pruning", () => {
  test("keeps active sessions and fork ancestors", () => {
    const logsDir = mkdtempSync(join(tmpdir(), "bureau-prune-"));
    for (const [name, age] of [
      ["leaf", 100],
      ["parent", 200],
      ["active", 300],
      ["old", 400],
    ] as const) {
      writeAged(join(logsDir, "agent-one", `${name}.jsonl`), name, age);
    }

    const plan = planPrune(
      "transcripts",
      { olderThanDays: 30, keepPerAgent: 0 },
      deps(logsDir, {
        activeSessionIds: new Set(["active"]),
        loadSessionsMap: () => ({ leaf: { forkedFrom: "parent" } }),
      }),
    );

    expect(plan.candidates.map((candidate) => candidate.sessionId).sort()).toEqual(["leaf", "old"]);
    expect(plan.skipped.map((skip) => skip.reason)).toEqual(["active-session", "fork-ancestor"]);
  });

  test("replans before apply so stale plans cannot delete newly active sessions", () => {
    const logsDir = mkdtempSync(join(tmpdir(), "bureau-prune-"));
    writeAged(join(logsDir, "agent-one", "old.jsonl"), "old", 100);
    const original = deps(logsDir);
    const plan = planPrune("transcripts", { olderThanDays: 30, keepPerAgent: 0 }, original);

    const result = applyPrune(plan, deps(logsDir, { activeSessionIds: new Set(["old"]) }));

    expect(result.deleted).toBe(0);
    expect(result.refused).toEqual([{ path: "agent-one/old.jsonl", reason: "became-active-session" }]);
    expect(existsSync(join(logsDir, "agent-one", "old.jsonl"))).toBe(true);
  });

  test("does not traverse symlinked attachment directories", () => {
    const root = mkdtempSync(join(tmpdir(), "bureau-prune-"));
    const logsDir = join(root, "logs");
    const outside = join(root, "outside");
    mkdirSync(join(logsDir, "agent-one"), { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeAged(join(outside, "secret.png"), "secret", 100);
    symlinkSync(outside, join(logsDir, "agent-one", "files"));

    const plan = planPrune("attachments", { olderThanDays: 30, keepPerAgent: 0 }, deps(logsDir));

    expect(plan.candidates).toEqual([]);
    expect(existsSync(join(outside, "secret.png"))).toBe(true);
  });

  test("protects queued attachments even before they appear in transcripts", () => {
    const logsDir = mkdtempSync(join(tmpdir(), "bureau-prune-"));
    writeAged(join(logsDir, "agent-one", "files", "queued.png"), "queued", 100);
    writeAged(join(logsDir, "agent-one", "files", "orphan.png"), "orphan", 100);

    const plan = planPrune("attachments", { olderThanDays: 30, keepPerAgent: 0 }, deps(logsDir, { queuedAttachments: () => new Set(["queued.png"]) }));

    expect(plan.candidates.map((candidate) => candidate.path)).toEqual(["agent-one/files/orphan.png"]);
    expect(plan.skipped).toContainEqual({ reason: "referenced", count: 1, bytes: 6 });
  });
});

function deps(logsDir: string, overrides: Partial<PruneDeps> = {}): PruneDeps {
  return {
    logsDir,
    now: NOW,
    activeSessionIds: new Set(),
    loadSessionsMap: () => ({}),
    queuedAttachments: () => new Set(),
    ...overrides,
  };
}

function writeAged(path: string, content: string, ageDays: number) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  const seconds = (NOW - ageDays * DAY_MS) / 1000;
  utimesSync(path, seconds, seconds);
}
