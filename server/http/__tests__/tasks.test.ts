import { describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import * as AgentManager from "../../agent-manager.ts";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { claimUserByName } from "../../users.ts";
import { handleTasksRequest } from "../tasks.ts";

const auth: AuthResult = {
  kind: "ok",
  session: {
    sessionIdHash: "hash",
    sessionPrefix: "sess",
    userId: "user-1",
    username: "Boss",
    role: "owner",
    needsRolling: false,
  },
};

describe("handleTasksRequest", () => {
  test("requires an authenticated caller for api task reads", async () => {
    const req = new Request("http://local.test/api/tasks");

    const res = await handleTasksRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "authenticated caller required" });
  });

  test("keeps legacy task reads available to loopback callers", async () => {
    const req = new Request("http://local.test/tasks");

    const res = await handleTasksRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(200);
    expect(Array.isArray(await res?.json())).toBe(true);
  });

  test("returns null for unrelated /api routes", async () => {
    const req = new Request("http://local.test/api/agents");

    await expect(handleTasksRequest(req, new URL(req.url))).resolves.toBeNull();
  });

  test("rejects invalid bearer tokens on /api/tasks", async () => {
    const req = new Request("http://local.test/api/tasks", {
      headers: { Authorization: "Bearer nope" },
    });

    const res = await handleTasksRequest(req, new URL(req.url));

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "invalid bearer token" });
  });

  test("requires an authenticated caller to create tasks", async () => {
    const req = new Request("http://local.test/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "Write tests", createdBy: "spoofed" }),
    });

    const res = await handleTasksRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "authenticated caller required" });
  });

  test("keeps legacy task creates available to loopback callers", async () => {
    const req = new Request("http://local.test/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "Legacy create", createdBy: "Scheduler" }),
    });

    const res = await handleTasksRequest(req, new URL(req.url), { kind: "loopback" });
    const body = await res?.json();

    expect(res?.status).toBe(201);
    expect(body.createdBy).toBe("Scheduler");

    const cleanup = new Request(`http://local.test/tasks/${body.id}`, { method: "DELETE" });
    await handleTasksRequest(cleanup, new URL(cleanup.url), { kind: "loopback" });
  });

  test("keeps legacy task routes global-only", async () => {
    const roomId = AgentManager.getRooms()[0]!.id;
    const roomTask = await createTask("Legacy hidden room task", roomId, auth);
    const globalTask = await createTask("Legacy visible global task", undefined, auth);
    const listReq = new Request("http://local.test/tasks?status=all");
    const detailReq = new Request(`http://local.test/tasks/${roomTask.id}`);
    const legacyCreateReq = new Request("http://local.test/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "Legacy forced global", createdBy: "Scheduler", roomId }),
    });

    const listRes = await handleTasksRequest(listReq, new URL(listReq.url), { kind: "loopback" });
    const list = (await listRes?.json()) as { id: string }[];
    const detailRes = await handleTasksRequest(detailReq, new URL(detailReq.url), { kind: "loopback" });
    const legacyCreateRes = await handleTasksRequest(legacyCreateReq, new URL(legacyCreateReq.url), { kind: "loopback" });
    const legacyCreated = await legacyCreateRes?.json();

    expect(listRes?.status).toBe(200);
    expect(list.map((task) => task.id)).toContain(globalTask.id);
    expect(list.map((task) => task.id)).not.toContain(roomTask.id);
    expect(detailRes?.status).toBe(404);
    expect(legacyCreateRes?.status).toBe(201);
    expect(legacyCreated.roomId).toBeUndefined();

    await deleteTask(roomTask.id, auth);
    await deleteTask(globalTask.id, auth);
    await deleteTask(legacyCreated.id, auth);
  });

  test("creates tasks using authenticated user attribution", async () => {
    const room = AgentManager.getRooms()[0]!;
    const req = new Request("http://local.test/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "Write tests", createdBy: "spoofed", roomId: room.id }),
    });

    const res = await handleTasksRequest(req, new URL(req.url), auth);
    const body = await res?.json();

    expect(res?.status).toBe(201);
    expect(body.createdBy).toBe("Boss");
    expect(body.roomId).toBe(room.id);

    const cleanup = new Request(`http://local.test/api/tasks/${body.id}`, { method: "DELETE" });
    await handleTasksRequest(cleanup, new URL(cleanup.url), auth);
  });

  test("updates task room over the api", async () => {
    const roomId = AgentManager.getRooms()[0]!.id;
    const createReq = new Request("http://local.test/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "Move me" }),
    });
    const created = await (await handleTasksRequest(createReq, new URL(createReq.url), auth))?.json();
    const updateReq = new Request(`http://local.test/api/tasks/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ roomId }),
    });

    const res = await handleTasksRequest(updateReq, new URL(updateReq.url), auth);
    const body = await res?.json();

    expect(res?.status).toBe(200);
    expect(body.roomId).toBe(roomId);

    const cleanup = new Request(`http://local.test/api/tasks/${created.id}`, { method: "DELETE" });
    await handleTasksRequest(cleanup, new URL(cleanup.url), auth);
  });

  test("replays api task creates with the same idempotency key", async () => {
    const firstReq = new Request("http://local.test/api/tasks", {
      method: "POST",
      headers: { "Idempotency-Key": `task-create-${randomUUID()}` },
      body: JSON.stringify({ title: "Create once" }),
    });
    const secondReq = new Request("http://local.test/api/tasks", {
      method: "POST",
      headers: firstReq.headers,
      body: JSON.stringify({ title: "Create once" }),
    });

    const firstRes = await handleTasksRequest(firstReq, new URL(firstReq.url), auth);
    const secondRes = await handleTasksRequest(secondReq, new URL(secondReq.url), auth);
    const first = await firstRes?.json();
    const second = await secondRes?.json();

    expect(firstRes?.status).toBe(201);
    expect(secondRes?.status).toBe(201);
    expect(second.id).toBe(first.id);
    expect(second.title).toBe("Create once");

    await deleteTask(first.id, auth);
  });

  test("scopes task create idempotency keys to the caller", async () => {
    const member = claimUserByName(`Tasks Member Retry ${randomUUID()}`, { role: "member", allowedRooms: [AgentManager.getRooms()[0]!.id] });
    const memberAuth = authFor(member.id, member.name, "member");
    const key = `shared-create-${randomUUID()}`;
    const ownerReq = new Request("http://local.test/api/tasks", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify({ title: "Owner task" }),
    });
    const memberReq = new Request("http://local.test/api/tasks", {
      method: "POST",
      headers: { "Idempotency-Key": key },
      body: JSON.stringify({ title: "Member task" }),
    });

    const ownerTask = await (await handleTasksRequest(ownerReq, new URL(ownerReq.url), auth))?.json();
    const memberTask = await (await handleTasksRequest(memberReq, new URL(memberReq.url), memberAuth))?.json();

    expect(ownerTask.id).not.toBe(memberTask.id);
    expect(ownerTask.title).toBe("Owner task");
    expect(memberTask.title).toBe("Member task");

    await deleteTask(ownerTask.id, auth);
    await deleteTask(memberTask.id, auth);
  });

  test("filters api task reads to rooms the member can access", async () => {
    const allowedRoom = AgentManager.getRooms()[0]!;
    const hiddenRoomId = AgentManager.createRoom("Hidden tasks");
    const member = claimUserByName(`Tasks Member Filter ${randomUUID()}`, { role: "member", allowedRooms: [allowedRoom.id] });
    const memberAuth = authFor(member.id, member.name, "member");
    const globalTask = await createTask("Visible global", undefined, auth);
    const allowedTask = await createTask("Visible room", allowedRoom.id, auth);
    const hiddenTask = await createTask("Hidden room", hiddenRoomId, auth);

    const req = new Request("http://local.test/api/tasks");
    const res = await handleTasksRequest(req, new URL(req.url), memberAuth);
    const body = (await res?.json()) as { id: string }[];
    const ids = body.map((task) => task.id);

    expect(res?.status).toBe(200);
    expect(ids).toContain(globalTask.id);
    expect(ids).toContain(allowedTask.id);
    expect(ids).not.toContain(hiddenTask.id);

    await deleteTask(globalTask.id, auth);
    await deleteTask(allowedTask.id, auth);
    await deleteTask(hiddenTask.id, auth);
    AgentManager.closeRoom(hiddenRoomId);
  });

  test("returns a uniform 404 when members create or move tasks into inaccessible rooms", async () => {
    const allowedRoom = AgentManager.getRooms()[0]!;
    const hiddenRoomId = AgentManager.createRoom("No task access");
    const member = claimUserByName(`Tasks Member Write ${randomUUID()}`, { role: "member", allowedRooms: [allowedRoom.id] });
    const memberAuth = authFor(member.id, member.name, "member");
    const task = await createTask("Allowed task", allowedRoom.id, memberAuth);

    const hiddenCreate = new Request("http://local.test/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "Hidden create", roomId: hiddenRoomId }),
    });
    const missingCreate = new Request("http://local.test/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "Missing create", roomId: "missing-room" }),
    });
    const hiddenMove = new Request(`http://local.test/api/tasks/${task.id}`, {
      method: "PATCH",
      body: JSON.stringify({ roomId: hiddenRoomId }),
    });

    expect((await handleTasksRequest(hiddenCreate, new URL(hiddenCreate.url), memberAuth))?.status).toBe(404);
    expect((await handleTasksRequest(missingCreate, new URL(missingCreate.url), memberAuth))?.status).toBe(404);
    expect((await handleTasksRequest(hiddenMove, new URL(hiddenMove.url), memberAuth))?.status).toBe(404);

    await deleteTask(task.id, auth);
    AgentManager.closeRoom(hiddenRoomId);
  });

  test("returns not found when members address tasks in inaccessible rooms", async () => {
    const allowedRoom = AgentManager.getRooms()[0]!;
    const hiddenRoomId = AgentManager.createRoom("Private tasks");
    const member = claimUserByName(`Tasks Member Hidden ${randomUUID()}`, { role: "member", allowedRooms: [allowedRoom.id] });
    const memberAuth = authFor(member.id, member.name, "member");
    const hiddenTask = await createTask("Private task", hiddenRoomId, auth);
    const detail = new Request(`http://local.test/api/tasks/${hiddenTask.id}`);
    const patch = new Request(`http://local.test/api/tasks/${hiddenTask.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "Rename" }),
    });
    const remove = new Request(`http://local.test/api/tasks/${hiddenTask.id}`, { method: "DELETE" });

    expect((await handleTasksRequest(detail, new URL(detail.url), memberAuth))?.status).toBe(404);
    expect((await handleTasksRequest(patch, new URL(patch.url), memberAuth))?.status).toBe(404);
    expect((await handleTasksRequest(remove, new URL(remove.url), memberAuth))?.status).toBe(404);

    await deleteTask(hiddenTask.id, auth);
    AgentManager.closeRoom(hiddenRoomId);
  });

  test("deletes tasks over the api", async () => {
    const createReq = new Request("http://local.test/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "Delete me" }),
    });
    const created = await (await handleTasksRequest(createReq, new URL(createReq.url), auth))?.json();
    const deleteReq = new Request(`http://local.test/api/tasks/${created.id}`, { method: "DELETE" });

    const res = await handleTasksRequest(deleteReq, new URL(deleteReq.url), auth);

    expect(res?.status).toBe(204);
  });
});

function authFor(userId: string, username: string, role: "owner" | "member"): AuthResult {
  return {
    kind: "ok",
    session: {
      sessionIdHash: `${userId}-hash`,
      sessionPrefix: "sess",
      userId,
      username,
      role,
      needsRolling: false,
    },
  };
}

async function createTask(title: string, roomId: string | undefined, caller: AuthResult): Promise<{ id: string }> {
  const req = new Request("http://local.test/api/tasks", {
    method: "POST",
    body: JSON.stringify({ title, roomId }),
  });
  const res = await handleTasksRequest(req, new URL(req.url), caller);
  expect(res?.status).toBe(201);
  return (await res?.json()) as { id: string };
}

async function deleteTask(taskId: string, caller: AuthResult): Promise<void> {
  const req = new Request(`http://local.test/api/tasks/${taskId}`, { method: "DELETE" });
  await handleTasksRequest(req, new URL(req.url), caller);
}
