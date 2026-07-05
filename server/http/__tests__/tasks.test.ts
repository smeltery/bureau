import { describe, expect, test } from "bun:test";
import { handleTasksRequest } from "../tasks.ts";

describe("handleTasksRequest", () => {
  test("accepts /api/tasks as an alias for task list reads", async () => {
    const req = new Request("http://local.test/api/tasks");

    const res = await handleTasksRequest(req, new URL(req.url));

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
});
