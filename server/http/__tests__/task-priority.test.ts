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
