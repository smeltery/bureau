import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("owner compression API preserves session history and refuses stale owner authority", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-compression-http-"));
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
      import { expect } from "bun:test";
      import { existsSync, utimesSync } from "node:fs";
      import { join } from "node:path";
      import { handleStorageRequest } from "./server/http/storage.ts";
      import { claimUserByName, updateUserById } from "./server/users.ts";
      import { appendLog, loadLog, loadLogWithAncestors } from "./server/persistence/logs/logs.ts";
      import { findLatestSession, listAgentSessions, persistSessionFork } from "./server/persistence/logs/sessions.ts";
      import { LOGS_DIR } from "./server/persistence/paths.ts";
      const owner = claimUserByName("Owner", { role: "owner" });
      const member = claimUserByName("Member", { role: "member" });
      const auth = user => ({ kind: "ok", session: { userId: user.id, role: user.role } });
      const url = new URL("http://localhost/api/storage/compress");
      const request = (body = { olderThanDays: 30 }) => new Request(url, { method: "POST", body: JSON.stringify(body) });
      const handle = (req, session = auth(owner)) => handleStorageRequest(req, url, session);
      for (const session of [null, { kind: "loopback" }, { kind: "api", token: {} }]) expect((await handle(request(), session)).status).toBe(401);
      expect((await handle(request(), auth(member))).status).toBe(403);
      expect((await handle(new Request(url))).status).toBe(405);
      for (const body of [null, [], { olderThanDays: 0 }, { olderThanDays: 36501 }, { olderThanDays: 1.5 }, { olderThanDays: 30, apply: "yes" }, { olderThanDays: 30, candidates: [] }]) expect((await handle(request(body))).status).toBe(400);
      const entry = { id: "first", kind: "text", text: "history ".repeat(1000), timestamp: 1 };
      appendLog("agent-one", "parent", entry);
      appendLog("agent-one", "parent", { ...entry, id: "fork", text: "fork point" });
      appendLog("agent-one", "child", { ...entry, id: "child", text: "branched reply ".repeat(100) });
      persistSessionFork("agent-one", "child", "parent", "fork", "Branch", 1, "/tmp");
      for (const id of ["parent", "child"]) utimesSync(join(LOGS_DIR, "agent-one", id + ".jsonl"), 1, 1);
      const before = loadLogWithAncestors("agent-one", "child");
      const preview = await (await handle(request())).json();
      expect(preview.plan.candidates).toHaveLength(2);
      expect(preview.applied).toBeNull();
      expect(existsSync(join(LOGS_DIR, "agent-one", "parent.jsonl.gz"))).toBe(false);
      const applied = await (await handle(request({ olderThanDays: 30, apply: true }))).json();
      expect(applied.applied.compressed).toBe(2);
      expect(loadLogWithAncestors("agent-one", "child")).toEqual(before);
      expect(listAgentSessions("agent-one").map(row => row.sessionId).sort()).toEqual(["child", "parent"]);
      expect(findLatestSession("agent-one")).not.toBeNull();
      appendLog("agent-one", "parent", { ...entry, id: "resumed", text: "next turn" });
      expect(loadLog("agent-one", "parent").map(row => row.id)).toEqual(["first", "fork", "resumed"]);
      const pending = handle(request({ olderThanDays: 30, apply: true }));
      updateUserById(owner.id, { role: "member" });
      expect((await pending).status).toBe(403);
      process.exit(0);
    `,
      ],
      { env: { ...process.env, BUREAU_HOME: root }, stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
