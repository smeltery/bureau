import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { appendTranscript, listTranscripts, readTranscript } from "../persistence/logs/transcript-files.ts";
import { applyCompression, planCompression, type CompressionDeps } from "./compress.ts";
import { applyPrune, planPrune, type PruneDeps } from "./prune.ts";
import { measureStorage } from "../storage-usage.ts";

const roots: string[] = [];
const DAY = 86_400_000;
const content = JSON.stringify({ kind: "text", text: "old conversation ".repeat(100), attachments: [{ filename: "keep.png" }] }) + "\n";
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bureau-compress-"));
  roots.push(root);
  const logsDir = join(root, "logs"),
    directory = join(logsDir, "agent-one");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "old.jsonl");
  writeFileSync(path, content);
  const timestamp = (Date.now() - 90 * DAY) / 1000;
  utimesSync(path, timestamp, timestamp);
  const deps: CompressionDeps = { logsDir, now: Date.now(), isActive: () => false };
  return { root, logsDir, directory, path, deps };
}
const pruneDeps = (logsDir: string): PruneDeps => ({ logsDir, now: Date.now(), activeSessionIds: new Set(), loadSessionsMap: () => ({}), queuedAttachments: () => new Set() });

test("preview does not write; compression preserves bytes, history age and resumed appends", async () => {
  const f = fixture();
  const modified = statSync(f.path).mtimeMs,
    directoryTime = statSync(f.directory).mtimeMs;
  const plan = planCompression(30, f.deps);
  expect(plan.candidates).toHaveLength(1);
  expect(existsSync(`${f.path}.gz`)).toBe(false);
  const result = await applyCompression(plan, f.deps);
  expect(result.compressed).toBe(1);
  expect(result.bytesAfter).toBeLessThan(result.bytesBefore);
  expect(existsSync(f.path)).toBe(false);
  expect(readTranscript(f.directory, "old").toString()).toBe(content);
  expect(statSync(`${f.path}.gz`).mtimeMs).toBeCloseTo(modified, 1);
  expect(statSync(f.directory).mtimeMs).toBeCloseTo(directoryTime, 1);
  expect(listTranscripts(f.directory).map((file) => file.sessionId)).toEqual(["old"]);
  const usage = measureStorage({ stateRoot: f.root, backupDir: null });
  expect(usage.agents[0].sessions).toBe(1);
  expect(usage.agents[0].transcriptBytes).toBe(result.bytesAfter);
  appendTranscript(f.directory, "old", '{"kind":"text","text":"new"}\n');
  expect(readFileSync(f.path, "utf8")).toBe(content + '{"kind":"text","text":"new"}\n');
  expect(existsSync(`${f.path}.gz`)).toBe(false);
});

test("active and recent sessions are spared, including a resume while gzip runs", async () => {
  const f = fixture();
  expect(planCompression(30, { ...f.deps, isActive: () => true }).skipped[0].reason).toBe("active-session");
  expect(planCompression(100, f.deps).skipped[0].reason).toBe("too-recent");
  let active = false;
  const result = await applyCompression(planCompression(30, f.deps), {
    ...f.deps,
    isActive: () => active,
    compress: async (bytes) => {
      active = true;
      return gzipSync(bytes);
    },
  });
  expect(result.refused[0].reason).toBe("became-active-session");
  expect(readFileSync(f.path, "utf8")).toBe(content);
});

test("appends, directory replacement and revoked authority during gzip cannot publish", async () => {
  for (const scenario of ["append", "directory", "owner"] as const) {
    const f = fixture();
    let owner = true;
    const result = await applyCompression(planCompression(30, f.deps), {
      ...f.deps,
      canApply: () => owner,
      compress: async (bytes) => {
        if (scenario === "append") appendTranscript(f.directory, "old", "new\n");
        if (scenario === "owner") owner = false;
        if (scenario === "directory") {
          const outside = join(f.root, "outside");
          mkdirSync(outside);
          writeFileSync(join(outside, "old.jsonl"), content);
          rmSync(f.directory, { recursive: true });
          symlinkSync(outside, f.directory, "dir");
        }
        return gzipSync(bytes);
      },
    });
    expect(result.compressed).toBe(0);
    expect(existsSync(f.path)).toBe(true);
    expect(existsSync(`${f.path}.gz`)).toBe(false);
  }
});

test("stale and forged plans cannot compress changed or outside files", async () => {
  const f = fixture(),
    plan = planCompression(30, f.deps);
  appendTranscript(f.directory, "old", "changed\n");
  expect((await applyCompression(plan, f.deps)).compressed).toBe(0);
  plan.candidates[0].path = "../outside.jsonl";
  expect((await applyCompression(plan, f.deps)).refused[0].reason).toBe("not-in-fresh-plan");
});

test("compressed histories protect attachments and retain pruning safeguards", async () => {
  const f = fixture();
  await applyCompression(planCompression(30, f.deps), f.deps);
  mkdirSync(join(f.directory, "files"));
  for (const name of ["keep.png", "orphan.png"]) {
    const path = join(f.directory, "files", name);
    writeFileSync(path, name);
    utimesSync(path, 1, 1);
  }
  const deps = pruneDeps(f.logsDir);
  const policy = { olderThanDays: 30, keepPerAgent: 0 };
  expect(planPrune("attachments", policy, deps).candidates.map((file) => file.path)).toEqual(["agent-one/files/orphan.png"]);
  expect(planPrune("transcripts", { ...policy, keepPerAgent: 1 }, deps).candidates).toEqual([]);
  expect(planPrune("transcripts", policy, { ...deps, loadSessionsMap: () => ({ child: { forkedFrom: "old" } }) }).candidates).toEqual([]);
  const plan = planPrune("transcripts", policy, deps);
  expect(plan.candidates[0].path).toEndWith(".jsonl.gz");
  expect(applyPrune(plan, deps).deleted).toBe(1);
  expect(listTranscripts(f.directory)).toEqual([]);
});

test("plain crash leftovers win and pruning never resurrects the compressed fallback", () => {
  const f = fixture();
  writeFileSync(`${f.path}.gz`, gzipSync("stale"));
  expect(listTranscripts(f.directory)).toHaveLength(1);
  expect(readTranscript(f.directory, "old").toString()).toBe(content);
  const deps = pruneDeps(f.logsDir);
  expect(applyPrune(planPrune("transcripts", { olderThanDays: 30, keepPerAgent: 0 }, deps), deps).deleted).toBe(1);
  expect(existsSync(`${f.path}.gz`)).toBe(false);
  expect(listTranscripts(f.directory)).toEqual([]);
});

test("corrupt compressed history refuses append and keeps attachment pruning conservative", () => {
  const f = fixture();
  unlinkSync(f.path);
  writeFileSync(`${f.path}.gz`, "broken gzip");
  expect(() => appendTranscript(f.directory, "old", "new\n")).toThrow();
  expect(existsSync(f.path)).toBe(false);
  mkdirSync(join(f.directory, "files"));
  const attachment = join(f.directory, "files", "unknown.png");
  writeFileSync(attachment, "keep");
  utimesSync(attachment, 1, 1);
  expect(planPrune("attachments", { olderThanDays: 30, keepPerAgent: 0 }, pruneDeps(f.logsDir)).candidates).toEqual([]);
});

test("compression failure or no space savings leaves the original intact", async () => {
  for (const compress of [
    async () => {
      throw new Error("compression unavailable");
    },
    async (bytes: Buffer) => bytes,
  ]) {
    const f = fixture();
    const result = await applyCompression(planCompression(30, f.deps), { ...f.deps, compress });
    expect(result.compressed).toBe(0);
    expect(readFileSync(f.path, "utf8")).toBe(content);
    expect(existsSync(`${f.path}.gz`)).toBe(false);
  }
});
