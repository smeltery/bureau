import { loadTasks } from "../../persistence.ts";
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
    absoluteExpiresAt: Date.now() + 86_400_000,
  },
};

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const req = new Request(`http://local.test/api/tasks${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = (await handleTasksRequest(req, new URL(req.url), auth))!;
  return { status: res.status, json: res.status === 204 ? null : await res.json() };
}

describe("task versions", () => {
  test("every read carries a version that changes with the task", async () => {
    const created = (await call("POST", "", { title: "Versioned" })).json;
    expect(typeof created.version).toBe("string");
    expect((await call("GET", `/${created.id}`)).json.version).toBe(created.version);
    const listed = (await call("GET", "?status=all")).json.find((t: { id: string }) => t.id === created.id);
    expect(listed.version).toBe(created.version);

    const edited = await call("PATCH", `/${created.id}`, { title: "Versioned 2", version: created.version });
    expect(edited.status).toBe(200);
    expect(edited.json.version).not.toBe(created.version);
    await call("DELETE", `/${created.id}`);
  });

  test("a stale version is a 409 carrying the current task and changes nothing", async () => {
    const created = (await call("POST", "", { title: "Race" })).json;
    await call("PATCH", `/${created.id}`, { title: "First writer", version: created.version });

    const stale = await call("PATCH", `/${created.id}`, { title: "Second writer", version: created.version });
    expect(stale.status).toBe(409);
    expect(stale.json.task.title).toBe("First writer");
    expect(stale.json.version).toBe(stale.json.task.version);
    expect((await call("GET", `/${created.id}`)).json.title).toBe("First writer");
    await call("DELETE", `/${created.id}`);
  });

  test("an edit without a version still applies, and a malformed one is a 400", async () => {
    const created = (await call("POST", "", { title: "Unversioned" })).json;
    expect((await call("PATCH", `/${created.id}`, { title: "Edited" })).status).toBe(200);
    expect((await call("PATCH", `/${created.id}`, { title: "Bad", version: 7 })).status).toBe(400);
    expect((await call("PATCH", `/${created.id}`, { title: "Bad", version: "" })).status).toBe(400);
    expect((await call("GET", `/${created.id}`)).json.title).toBe("Edited");
    await call("DELETE", `/${created.id}`);
  });
});

describe("task claims", () => {
  test("a claim does not take a task someone else holds", async () => {
    const created = (await call("POST", "", { title: "Held" })).json;
    expect((await call("POST", `/${created.id}/claim`, { assignee: "Ada" })).json.assignee).toBe("Ada");

    const taken = await call("POST", `/${created.id}/claim`, { assignee: "Grace" });
    expect(taken.status).toBe(409);
    expect(taken.json.assignee).toBe("Ada");
    expect((await call("POST", `/${created.id}/claim`, {})).status).toBe(409);
    expect((await call("GET", `/${created.id}`)).json.assignee).toBe("Ada");

    expect((await call("POST", `/${created.id}/claim`, { assignee: "Ada" })).status).toBe(200);
    await call("DELETE", `/${created.id}`);
  });

  test("an unheld task can be claimed with or without a name", async () => {
    const created = (await call("POST", "", { title: "Free" })).json;
    const claimed = await call("POST", `/${created.id}/claim`, {});
    expect(claimed.status).toBe(200);
    expect(claimed.json.status).toBe("in_progress");
    expect(claimed.json.assignee).toBeUndefined();
    await call("DELETE", `/${created.id}`);
  });
});

describe("task priority updates", () => {
  test("clears task priority with null and rejects empty priority", async () => {
    const createReq = new Request("http://local.test/api/tasks", {
      method: "POST",
      body: JSON.stringify({ title: "Clear priority", priority: "P1" }),
    });
    const created = await (await handleTasksRequest(createReq, new URL(createReq.url), auth))?.json();

    const emptyPriority = new Request(`http://local.test/api/tasks/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ priority: "" }),
    });
    const emptyRes = await handleTasksRequest(emptyPriority, new URL(emptyPriority.url), auth);
    expect(emptyRes?.status).toBe(400);
    expect(await emptyRes?.json()).toEqual({ error: "invalid priority, must be P0-P3 or null to clear" });

    const clearPriority = new Request(`http://local.test/api/tasks/${created.id}`, {
      method: "PATCH",
      body: JSON.stringify({ priority: null }),
    });
    const cleared = await (await handleTasksRequest(clearPriority, new URL(clearPriority.url), auth))?.json();
    expect(cleared.priority).toBeUndefined();
    expect("priority" in cleared).toBe(false);

    const cleanup = new Request(`http://local.test/api/tasks/${created.id}`, { method: "DELETE" });
    await handleTasksRequest(cleanup, new URL(cleanup.url), auth);
  });
});

test("obsolete tasks persist, leave active lists, remain readable and can reopen", async () => {
  const created = (await call("POST", "", { title: "Superseded work" })).json;
  try {
    const closed = await call("PATCH", `/${created.id}`, { status: "obsolete", description: "Replaced by another approach", version: created.version });
    expect(closed.status).toBe(200);
    expect(closed.json.status).toBe("obsolete");
    expect(loadTasks().find((task) => task.id === created.id)?.status).toBe("obsolete");
    expect((await call("GET", "")).json.some((task: any) => task.id === created.id)).toBe(false);
    expect((await call("GET", "?status=obsolete")).json.some((task: any) => task.id === created.id)).toBe(true);
    expect((await call("GET", "?status=all")).json.some((task: any) => task.id === created.id)).toBe(true);
    expect((await call("GET", `/${created.id}`)).json.description).toBe("Replaced by another approach");
    expect((await call("PATCH", `/${created.id}`, { status: "open", version: closed.json.version })).status).toBe(200);
    expect((await call("GET", "")).json.some((task: any) => task.id === created.id)).toBe(true);
  } finally {
    await call("DELETE", `/${created.id}`);
  }
});
