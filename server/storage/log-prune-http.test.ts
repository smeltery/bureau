import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("owner cleanup preserves token cursors across restart and protects recordings and authorization races", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-log-cleanup-http-"));
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
      import { expect } from "bun:test";
      import { existsSync, utimesSync, readFileSync, writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { handleStorageRequest } from "./server/http/storage.ts";
      import { mintApiToken, enqueueApiTokenInboxMessage, drainApiTokenInbox, revokeApiToken, _testResetApiTokens } from "./server/auth/api-tokens.ts";
      import { claimUserByName, setUserRoleById } from "./server/users.ts";
      import { tokenLogPath } from "./server/auth/api-token-log.ts";
      import { BUREAU_DIR, API_TOKENS_FILE } from "./server/persistence/paths.ts";
      import { saveRecordingEnabled, startRecording } from "./server/terminal-recordings/store.ts";
      import { recordingPath } from "./server/terminal-recordings/files.ts";
      const owner = claimUserByName("Log cleanup owner", { role: "owner" });
      const auth = { kind: "ok", session: { userId: owner.id, role: "owner" } };
      const deps = { stateRoot: BUREAU_DIR, logsDir: join(BUREAU_DIR, "logs"), backupDir: null, now: Date.now, pruneDeps: () => { throw new Error("Unexpected transcript scan"); } };
      const request = (body, identity = auth) => {
        const req = new Request("http://localhost/api/storage/prune", { method: "POST", body: JSON.stringify(body) });
        return handleStorageRequest(req, new URL(req.url), identity, deps);
      };
      const age = path => { const time = new Date(Date.now() - 90 * 86400000); utimesSync(path, time, time); };
      const minted = await mintApiToken({ userId: owner.id, name: "retained counter", expiresInDays: null });
      const id = minted.apiToken.id;
      const send = text => enqueueApiTokenInboxMessage({ tokenId: id, userId: owner.id, text, senderAgentId: "agent", senderAgentName: "Agent", senderRoomName: "Room" });
      await send("one"); await send("two"); age(tokenLogPath(id));
      const policy = { target: "token-logs", olderThanDays: 30 };
      expect((await request(policy, { kind: "api", token: { role: "owner" } })).status).toBe(401);
      expect((await request(policy, { kind: "loopback" })).status).toBe(401);
      const preview = await (await request(policy)).json();
      expect(preview.applied).toBeNull(); expect(preview.plan.candidates).toHaveLength(1);
      expect(existsSync(tokenLogPath(id))).toBe(true);
      const metadata = JSON.parse(readFileSync(API_TOKENS_FILE, "utf8"));
      metadata[id].lastSequence = 0; writeFileSync(API_TOKENS_FILE, JSON.stringify(metadata));
      expect((await (await request({ ...policy, apply: true })).json()).applied.deleted).toBe(1);
      expect(JSON.parse(readFileSync(API_TOKENS_FILE, "utf8"))[id].lastSequence).toBe(2);
      const empty = await drainApiTokenInbox(id, Date.now(), 0);
      expect(empty.entries).toEqual([]); expect(empty.latestSequence).toBe(2); expect(empty.firstSequence).toBe(2);
      _testResetApiTokens(); await send("three");
      const resumed = await drainApiTokenInbox(id, Date.now(), 2);
      expect(resumed.entries.map(row => row.sequence)).toEqual([3]); expect(resumed.firstSequence).toBe(3);
      await revokeApiToken(owner.id, id); age(tokenLogPath(id));
      expect((await (await request({ ...policy, apply: true })).json()).applied.deleted).toBe(1);
      saveRecordingEnabled(true);
      const recording = startRecording("agent", "room", () => {}); age(recordingPath(recording.id));
      const recordingPolicy = { target: "terminal-recordings", olderThanDays: 30, apply: true };
      const active = await (await request(recordingPolicy)).json();
      expect(active.applied.deleted).toBe(0); expect(active.plan.skipped[0].reason).toBe("active-recording");
      recording.close("closed"); age(recordingPath(recording.id));
      const pending = request(recordingPolicy); setUserRoleById(owner.id, "member");
      expect((await pending).status).toBe(403); expect(existsSync(recordingPath(recording.id))).toBe(true);
      setUserRoleById(owner.id, "owner");
      expect((await (await request(recordingPolicy)).json()).applied.deleted).toBe(1);
      expect((await request({ target: "token-logs", olderThanDays: 0 })).status).toBe(400);
      expect((await request({ ...policy, extra: "x".repeat(17000) })).status).toBe(400);
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
