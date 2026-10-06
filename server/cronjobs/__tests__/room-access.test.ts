import { accumulateRunSessionUsage } from "../../persistence/cronjob-run-sessions.ts";
import { buildUsageReportData, usageAudienceForUser } from "../../agents/usage/report.ts";
import { loadCronjobs, saveCronjobs } from "../../persistence/cronjobs.ts";
import { afterEach, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { UserRecord } from "../../../shared/types.ts";
import * as Agents from "../../agent-manager.ts";
import * as Jobs from "../index.ts";
import { claimUserByName, deleteUserById, updateUserById } from "../../users.ts";
import { bindWsUser, clearWsUser } from "../../user-sockets.ts";
import { browsers } from "../../ws/broadcast.ts";
import { broadcastScheduleEvent } from "../../ws/cronjob-events.ts";
import { handleCronjobsRequest } from "../../http/cronjobs.ts";
import { CRONJOBS_DIR } from "../../persistence/paths.ts";
import { canViewRun } from "../access.ts";

const users: UserRecord[] = [];
const rooms: string[] = [];
const jobs: string[] = [];
const sockets: ServerWebSocket<unknown>[] = [];
afterEach(() => {
  for (const ws of sockets.splice(0)) {
    browsers.delete(ws);
    clearWsUser(ws);
  }
  for (const id of jobs.splice(0)) {
    Jobs.deleteCronjob(id);
    rmSync(join(CRONJOBS_DIR, id), { recursive: true, force: true });
  }
  for (const user of users.splice(0)) deleteUserById(user.id);
  for (const id of rooms.splice(0)) Agents.closeRoom(id);
});

function user(role: "member" | "owner", allowedRooms: string[]) {
  const result = claimUserByName(crypto.randomUUID(), { role, allowedRooms });
  users.push(result);
  return result;
}
async function request(actor: UserRecord, path: string, method = "GET", body?: unknown) {
  const req = new Request(`http://local.test/api/cronjobs${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  return (await handleCronjobsRequest(req, new URL(req.url), {
    kind: "ok",
    session: { userId: actor.id, username: actor.name, role: actor.role, sessionIdHash: "hash", sessionPrefix: "prefix", needsRolling: false, absoluteExpiresAt: Date.now() + 60_000 },
  }))!;
}
function socket(actor: UserRecord) {
  const sent: any[] = [];
  const ws = {
    send: (text: string) => {
      sent.push(JSON.parse(text));
      return 0;
    },
  } as ServerWebSocket<unknown>;
  bindWsUser(ws, actor);
  browsers.add(ws);
  sockets.push(ws);
  return sent;
}

test("schedule room access covers reads, mutations, events, moved and deleted run history", async () => {
  const a = Agents.createRoom("Schedule A");
  const b = Agents.createRoom("Schedule B");
  rooms.push(a, b);
  const creator = user("member", [a]);
  const peer = user("member", [a]);
  const outsider = user("member", [b]);
  const owner = user("owner", [a, b]);
  const created = await request(creator, "", "POST", {
    name: "Private check",
    roomId: a,
    schedule: { type: "manual" },
    prompt: "Private prompt",
    cwd: process.cwd(),
    modelFamily: "opus",
    effort: "high",
    permissionMode: "bypassPermissions",
  });
  expect(created.status).toBe(201);
  const job = await created.json();
  jobs.push(job.id);
  expect((await request(peer, `/${job.id}`)).status).toBe(200);
  expect((await request(peer, `/${job.id}`, "PATCH", { name: "Changed" })).status).toBe(403);
  expect((await request(outsider, `/${job.id}`)).status).toBe(404);
  expect(await (await request(outsider, "")).json()).toEqual([]);
  expect((await request(creator, `/${job.id}`, "PATCH", { roomId: b })).status).toBe(403);

  Jobs.updateCronjob(job.id, { cwd: join(CRONJOBS_DIR, "missing-" + crypto.randomUUID()) });
  const run = Jobs.runCronjobNow(job.id, creator.name)!;
  expect(run).toMatchObject({ roomIdSnapshot: a, userIdSnapshot: creator.id });
  const peerEvents = socket(peer);
  const outsiderEvents = socket(outsider);
  broadcastScheduleEvent({ type: "cronjob_run_updated", run });
  expect(peerEvents).toHaveLength(1);
  expect(outsiderEvents).toHaveLength(0);
  expect((await request(owner, `/${job.id}`, "PATCH", { roomId: b })).status).toBe(200);
  expect((await request(peer, `/${job.id}/runs/${run.id}`)).status).toBe(200);
  expect((await request(outsider, `/${job.id}/runs/${run.id}`)).status).toBe(404);
  const nextRun = Jobs.runCronjobNow(job.id, owner.name)!;
  const tokens = { inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
  accumulateRunSessionUsage(job.id, run.id, "room-a-session", tokens, 1);
  accumulateRunSessionUsage(job.id, nextRun.id, "room-b-session", tokens, 2);
  expect(buildUsageReportData(usageAudienceForUser(peer)).cronjobs?.find((row) => row.id === job.id)?.lifetime.costUSD).toBe(1);
  expect(buildUsageReportData(usageAudienceForUser(outsider)).cronjobs?.find((row) => row.id === job.id)?.lifetime.costUSD).toBe(2);
  expect(buildUsageReportData(usageAudienceForUser(owner)).cronjobs?.find((row) => row.id === job.id)?.lifetime.costUSD).toBe(3);
  updateUserById(peer.id, { allowedRooms: [] });
  peerEvents.length = 0;
  broadcastScheduleEvent({ type: "cronjob_run_updated", run });
  expect(peerEvents).toHaveLength(0);
  updateUserById(peer.id, { allowedRooms: [a] });
  expect((await request(owner, `/${job.id}`, "DELETE")).status).toBe(204);
  expect((await request(peer, `/${job.id}/runs/${run.id}`)).status).toBe(200);
  expect(canViewRun(outsider, Jobs.getRunsForCronjob(job.id)[0]!)).toBe(false);
});

test("legacy schedule migration chooses the creator's room and preserves creator-only orphans", () => {
  const room = Agents.createRoom("Migration room");
  rooms.push(room);
  const creator = user("member", [room]);
  const job = Jobs.addCronjob({
    name: "Legacy",
    username: creator.name,
    userId: creator.id,
    cwd: process.cwd(),
    prompt: "Check",
    schedule: { type: "manual" },
    modelFamily: "opus",
    permissionMode: "never",
  });
  jobs.push(job.id);
  saveCronjobs([
    { ...job, roomId: undefined },
    { ...job, id: "orphan", roomId: undefined, userId: "missing", username: "missing" },
  ]);
  const migrated = loadCronjobs();
  expect(migrated[0].roomId).toBe(room);
  expect(migrated[1].roomId).toBeNull();
  saveCronjobs(migrated);
  updateUserById(creator.id, { defaultRoomId: null, allowedRooms: [] });
  expect(loadCronjobs()[0].roomId).toBe(room);
});
