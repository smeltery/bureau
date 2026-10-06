import { afterEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import * as Agents from "../agent-manager.ts";
import * as Jobs from "../cronjobs/index.ts";
import { claimUserByName, deleteUserById, updateUserById } from "../users.ts";
import type { UserRecord } from "../../shared/types.ts";
import { handleWebhookManagement } from "./routes.ts";
import { dispatchWebhook } from "./targets.ts";
import { listWebhooks, WEBHOOK_DIR } from "./store.ts";
const users: UserRecord[] = [],
  rooms: string[] = [],
  jobs: string[] = [];
afterEach(() => {
  for (const id of jobs.splice(0)) Jobs.deleteCronjob(id);
  for (const user of users.splice(0)) deleteUserById(user.id);
  for (const id of rooms.splice(0)) Agents.closeRoom(id);
  rmSync(WEBHOOK_DIR, { recursive: true, force: true });
});
function user(allowedRooms: string[]) {
  const row = claimUserByName(crypto.randomUUID(), { role: "member", allowedRooms });
  users.push(row);
  return row;
}
async function request(actor: UserRecord, path: string, method = "GET", body?: unknown) {
  const req = new Request(`http://localhost/api/webhooks${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  return (await handleWebhookManagement(req, new URL(req.url), {
    kind: "ok",
    session: { userId: actor.id, username: actor.name, role: actor.role, sessionIdHash: "h", sessionPrefix: "s", needsRolling: false, absoluteExpiresAt: Date.now() + 60000 },
  }))!;
}
test("webhook management is room scoped and dispatch records a schedule delivery", async () => {
  const room = Agents.createRoom("Webhook room");
  rooms.push(room);
  const creator = user([room]),
    peer = user([room]),
    outsider = user([]);
  const job = Jobs.addCronjob({
    name: "Check",
    roomId: room,
    userId: creator.id,
    username: creator.name,
    cwd: process.cwd(),
    prompt: "Check this event",
    schedule: { type: "manual" },
    modelFamily: "opus",
    permissionMode: "never",
  });
  jobs.push(job.id);
  Jobs.updateCronjob(job.id, { cwd: "/no-such-bureau-webhook-fixture" });
  const draft = { name: "Delivery", target: { kind: "schedule", id: job.id }, events: ["push"], actions: [], fields: ["ref"], enabled: true };
  expect((await request(outsider, "", "POST", draft)).status).toBe(403);
  const response = await request(creator, "", "POST", draft);
  expect(response.status).toBe(201);
  const created = await response.json();
  expect(created.secret).toHaveLength(64);
  expect(await (await request(outsider, "")).json()).toEqual([]);
  expect((await request(outsider, `/${created.id}`)).status).toBe(404);
  const visible = await (await request(peer, "")).json();
  expect(visible).toHaveLength(1);
  expect(visible[0].secret).toBeUndefined();
  expect((await request(peer, `/${created.id}/rotate`, "POST")).status).toBe(403);
  expect((await request(peer, `/${created.id}`, "DELETE")).status).toBe(403);
  const hook = listWebhooks()[0]!;
  const runId = dispatchWebhook(hook, "Selected event data", "delivery-42");
  expect(Jobs.getRunsForCronjob(job.id).find((run) => run.id === runId)).toMatchObject({
    trigger: "webhook",
    roomIdSnapshot: room,
    webhook: { hookId: hook.id, deliveryId: "delivery-42" },
    promptSnapshot: "Check this event\n\nSelected event data",
  });
  updateUserById(creator.id, { allowedRooms: [] });
  expect(() => dispatchWebhook(hook, "Revoked", "next")).toThrow("revoked");
});
