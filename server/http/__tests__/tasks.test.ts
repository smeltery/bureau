import { describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
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

  test("creates tasks using authenticated user attribution", async () => {
    const req = new Request("http://local.test/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "Write tests", createdBy: "spoofed", roomId: "room-a" }),
    });

    const res = await handleTasksRequest(req, new URL(req.url), auth);
    const body = await res?.json();

    expect(res?.status).toBe(201);
    expect(body.createdBy).toBe("Boss");
    expect(body.roomId).toBe("room-a");

    const cleanup = new Request(`http://local.test/api/tasks/${body.id}`, { method: "DELETE" });
    await handleTasksRequest(cleanup, new URL(cleanup.url), auth);
  });

  test("updates task room over the api", async () => {
    const createReq = new Request("http://local.test/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "Move me" }),
    });
    const created = await (await handleTasksRequest(createReq, new URL(createReq.url), auth))?.json();
    const updateReq = new Request(`http://local.test/api/tasks/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ roomId: "room-b" }),
    });

    const res = await handleTasksRequest(updateReq, new URL(updateReq.url), auth);
    const body = await res?.json();

    expect(res?.status).toBe(200);
    expect(body.roomId).toBe("room-b");

    const cleanup = new Request(`http://local.test/api/tasks/${created.id}`, { method: "DELETE" });
    await handleTasksRequest(cleanup, new URL(cleanup.url), auth);
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
