import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyLogPrune, planLogPrune, type LogPruneDeps } from "./log-prune.ts";
const roots: string[] = [];
const token = "1234567890abcdef",
  recording = "12345678-1234-1234-1234-1234567890ab";
function fixture() {
  const stateRoot = mkdtempSync(join(tmpdir(), "bureau-log-prune-"));
  roots.push(stateRoot);
  const active = new Set<string>(),
    removed: string[] = [];
  const deps: LogPruneDeps = { stateRoot, now: Date.now(), isRecordingActive: (id) => active.has(id), preserveTokenSequence: () => {}, tokenLogRemoved: (id) => removed.push(id) };
  function file(target: string, name: string, days = 90) {
    mkdirSync(join(stateRoot, target), { recursive: true });
    const path = join(stateRoot, target, name);
    writeFileSync(path, "old log\n");
    const time = new Date(deps.now - days * 86_400_000);
    utimesSync(path, time, time);
    return path;
  }
  return { deps, active, removed, file };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("whole-file pruning leaves recent, quarantined, temporary and unrelated files intact", () => {
  const f = fixture();
  const old = f.file("token-logs", `${token}.jsonl`);
  const recent = f.file("token-logs", "fedcba0987654321.jsonl", 1);
  const quarantine = f.file("token-logs", `${token}.jsonl.corrupt-123`);
  const temp = f.file("token-logs", `${token}.jsonl.tmp`);
  const settings = f.file("token-logs", "settings.jsonl");
  const plan = planLogPrune("token-logs", 30, f.deps);
  expect(plan.candidates.map((file) => file.path)).toEqual([`token-logs/${token}.jsonl`]);
  expect(plan.skipped).toEqual([{ reason: "too-recent", count: 1, bytes: 8 }]);
  expect(existsSync(old)).toBe(true);
  expect(applyLogPrune(plan, f.deps)).toEqual({ deleted: 1, bytes: 8, refused: [] });
  expect(f.removed).toEqual([token]);
  for (const path of [recent, quarantine, temp, settings]) expect(existsSync(path)).toBe(true);
});

test("active recordings are spared at preview and rechecked at apply", () => {
  const f = fixture();
  const path = f.file("terminal-recordings", `${recording}.jsonl`);
  f.active.add(recording);
  const live = planLogPrune("terminal-recordings", 30, f.deps);
  expect(live.candidates).toEqual([]);
  expect(live.skipped[0]?.reason).toBe("active-recording");
  f.active.clear();
  const plan = planLogPrune("terminal-recordings", 30, f.deps);
  f.active.add(recording);
  expect(applyLogPrune(plan, f.deps).refused[0]?.reason).toBe("active-recording");
  expect(existsSync(path)).toBe(true);
  f.active.clear();
  expect(applyLogPrune(plan, f.deps).deleted).toBe(1);
});

test("changed or replaced files and forged plans cannot be deleted", () => {
  const f = fixture();
  const path = f.file("token-logs", `${token}.jsonl`);
  const plan = planLogPrune("token-logs", 30, f.deps);
  renameSync(path, path + ".old");
  f.file("token-logs", `${token}.jsonl`);
  expect(applyLogPrune(plan, f.deps).refused[0]?.reason).toBe("modified-since-preview");
  expect(applyLogPrune({ ...plan }, f.deps).aborted).toBeDefined();
  plan.candidates.push({ path: "../outside", bytes: 8, ageDays: 90, mtimeMs: 0 });
  expect(applyLogPrune(plan, f.deps).refused.at(-1)?.reason).toBe("not-in-preview");
  expect(existsSync(path)).toBe(true);
});

test("symlinked files and replaced directory parents are never followed", () => {
  const f = fixture();
  const path = f.file("token-logs", `${token}.jsonl`);
  symlinkSync(path, join(f.deps.stateRoot, "token-logs", "aaaaaaaaaaaaaaaa.jsonl"));
  const plan = planLogPrune("token-logs", 30, f.deps);
  expect(plan.candidates).toHaveLength(1);
  const dir = join(f.deps.stateRoot, "token-logs");
  renameSync(dir, dir + "-moved");
  symlinkSync(dir + "-moved", dir);
  expect(applyLogPrune(plan, f.deps).refused[0]?.reason).toBe("directory-changed");
  expect(() => planLogPrune("token-logs", 30, f.deps)).toThrow();
  expect(existsSync(path)).toBe(true);
});

test("missing directories are empty and age limits reject unsafe values", () => {
  const f = fixture();
  const plan = planLogPrune("token-logs", 30, f.deps);
  expect(applyLogPrune(plan, f.deps)).toEqual({ deleted: 0, bytes: 0, refused: [] });
  for (const age of [0, 1.5, Infinity, 36501]) expect(() => planLogPrune("token-logs", age, f.deps)).toThrow();
});

test("failed sequence persistence leaves the recovery log intact", () => {
  const f = fixture();
  const path = f.file("token-logs", `${token}.jsonl`);
  const plan = planLogPrune("token-logs", 30, f.deps);
  f.deps.preserveTokenSequence = () => {
    throw new Error("metadata write failed");
  };
  expect(applyLogPrune(plan, f.deps).refused[0]?.reason).toBe("metadata write failed");
  expect(existsSync(path)).toBe(true);
  expect(f.removed).toEqual([]);
});
