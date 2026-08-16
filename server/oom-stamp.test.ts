import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { describe, expect, test } from "bun:test";
import { AGENT_OOM_SCORE_ADJ, createAgentOomStamper, descendantsOf, stampProcess } from "./oom-stamp.ts";

// A fake `/proc`: one directory per pid, each with a `stat` file (whose
// content we control down to the two fields the sweep reads) and an
// `oom_score_adj` file. `stat`'s process-name field intentionally contains a
// space and a paren to exercise the "split from the last `) `" parsing.
function fakeProc(root: string, pid: number, ppid: number, starttime: string, adj: number | null): void {
  const dir = join(root, String(pid));
  mkdirSync(dir, { recursive: true });
  // Fields after the "pid (comm) " prefix, starting at field 3 (state), so
  // index N-3 holds stat field N: index 0 is state, index 1 is ppid (field
  // 4), index 19 is starttime (field 22).
  const fields: string[] = new Array(25).fill("0");
  fields[0] = "S";
  fields[1] = String(ppid);
  fields[19] = starttime;
  writeFileSync(join(dir, "stat"), `${pid} (agent proc (weird)) ${fields.join(" ")}\n`);
  if (adj !== null) writeFileSync(join(dir, "oom_score_adj"), String(adj));
}

describe("descendantsOf", () => {
  test("finds a multi-generation tree and excludes the root and unrelated processes", () => {
    const root = mkdtempSync(join(tmpdir(), "bureau-oom-proc-"));
    fakeProc(root, 1, 0, "100", 0); // root, must not appear in the result
    fakeProc(root, 2, 1, "101", 0); // child
    fakeProc(root, 3, 2, "102", 0); // grandchild
    fakeProc(root, 9, 500, "103", 0); // unrelated process elsewhere on the box

    const found = descendantsOf(root, 1);

    expect([...found.keys()].sort()).toEqual([2, 3]);
    expect(found.get(3)?.ppid).toBe(2);
  });

  test("returns nothing for an unreadable proc root", () => {
    expect(descendantsOf(join(tmpdir(), "bureau-oom-missing"), 1).size).toBe(0);
  });
});

describe("stampProcess", () => {
  const isOurs = () => true;

  test("raises a process below target and confirms via readback", () => {
    const root = mkdtempSync(join(tmpdir(), "bureau-oom-stamp-"));
    fakeProc(root, 2, 1, "200", 100);
    const outcome = stampProcess({ procRoot: root, pid: 2, expected: { ppid: 1, starttime: "200" }, isOurs, target: AGENT_OOM_SCORE_ADJ });
    expect(outcome).toBe("stamped");
    expect(readFileSync(join(root, "2", "oom_score_adj"), "utf8").trim()).toBe(String(AGENT_OOM_SCORE_ADJ));
  });

  test("treats a process already at or above target as already-done and never lowers it", () => {
    const root = mkdtempSync(join(tmpdir(), "bureau-oom-stamp-"));
    fakeProc(root, 2, 1, "200", 900);
    const outcome = stampProcess({ procRoot: root, pid: 2, expected: { ppid: 1, starttime: "200" }, isOurs, target: AGENT_OOM_SCORE_ADJ });
    expect(outcome).toBe("already");
    expect(readFileSync(join(root, "2", "oom_score_adj"), "utf8").trim()).toBe("900");
  });

  test("skips a pid that no longer matches the identity we expected (recycled)", () => {
    const root = mkdtempSync(join(tmpdir(), "bureau-oom-stamp-"));
    fakeProc(root, 2, 1, "999", 100); // a different process now holds this pid
    const outcome = stampProcess({ procRoot: root, pid: 2, expected: { ppid: 1, starttime: "200" }, isOurs, target: AGENT_OOM_SCORE_ADJ });
    expect(outcome).toBe("skipped");
  });

  test("skips a pid that exited before it could be stamped", () => {
    const root = mkdtempSync(join(tmpdir(), "bureau-oom-stamp-missing-"));
    const outcome = stampProcess({ procRoot: root, pid: 999, expected: { ppid: 1, starttime: "200" }, isOurs, target: AGENT_OOM_SCORE_ADJ });
    expect(outcome).toBe("skipped");
  });

  test("reports a refusal when the write is accepted but does not stick", () => {
    const root = mkdtempSync(join(tmpdir(), "bureau-oom-stamp-refuse-"));
    fakeProc(root, 2, 1, "200", 100);
    const outcome = stampProcess({
      procRoot: root,
      pid: 2,
      expected: { ppid: 1, starttime: "200" },
      isOurs,
      target: AGENT_OOM_SCORE_ADJ,
      writeAdj: () => {}, // accepted, but never actually writes
    });
    expect(outcome).toBe("refused");
  });
});

describe("createAgentOomStamper", () => {
  test("stamps every descendant once, converges, and logs exactly once", () => {
    const root = mkdtempSync(join(tmpdir(), "bureau-oom-sweep-"));
    fakeProc(root, 1, 0, "100", 0);
    fakeProc(root, 2, 1, "101", 100);
    fakeProc(root, 3, 2, "102", 100);
    const logs: string[] = [];
    const stamper = createAgentOomStamper({ procRoot: root, rootPid: 1, log: (m) => logs.push(m) });

    const first = stamper.sweep();
    expect(first.stamped.sort()).toEqual([2, 3]);
    expect(logs.length).toBe(1);

    const second = stamper.sweep();
    expect(second.stamped).toEqual([]);
    expect(second.already).toBe(2);
    expect(logs.length).toBe(1); // announced only once per stamper lifetime
  });

  test("warns exactly once when a descendant refuses the stamp", () => {
    const root = mkdtempSync(join(tmpdir(), "bureau-oom-sweep-warn-"));
    fakeProc(root, 1, 0, "100", 0);
    fakeProc(root, 2, 1, "101", 100);
    const warnings: string[] = [];
    const stamper = createAgentOomStamper({ procRoot: root, rootPid: 1, log: () => {}, warn: (m) => warnings.push(m), writeAdj: () => {} });

    stamper.sweep();
    stamper.sweep();

    expect(warnings.length).toBe(1);
  });
});
