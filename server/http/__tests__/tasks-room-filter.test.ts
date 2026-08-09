import { describe, expect, test } from "bun:test";
import * as AgentManager from "../../agent-manager.ts";
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

describe("task room filtering", () => {
  test("filters api task reads by explicit room id", async () => {
    const room = AgentManager.getRooms()[0]!;
    const globalTask = await createTask("Global room filter", undefined);
    const roomTask = await createTask("Scoped room filter", room.id);

    const roomBody = await listTaskIds(`?status=all&roomId=${room.id}`);
    const globalBody = await listTaskIds("?status=all&roomId=");

    expect(roomBody).toEqual([roomTask.id]);
    expect(globalBody).toContain(globalTask.id);
    expect(globalBody).not.toContain(roomTask.id);
    expect((await getTasks("?roomId=missing-room"))?.status).toBe(404);

    await deleteTask(globalTask.id);
    await deleteTask(roomTask.id);
  });
});

async function createTask(title: string, roomId: string | undefined): Promise<{ id: string }> {
  const req = new Request("http://local.test/api/tasks", {
    method: "POST",
    body: JSON.stringify({ title, roomId }),
  });
  const res = await handleTasksRequest(req, new URL(req.url), auth);
  expect(res?.status).toBe(201);
  return (await res?.json()) as { id: string };
}

async function deleteTask(taskId: string): Promise<void> {
  const req = new Request(`http://local.test/api/tasks/${taskId}`, { method: "DELETE" });
  await handleTasksRequest(req, new URL(req.url), auth);
}

async function getTasks(query: string): Promise<Response | null> {
  const req = new Request(`http://local.test/api/tasks${query}`);
  return handleTasksRequest(req, new URL(req.url), auth);
}

async function listTaskIds(query: string): Promise<string[]> {
  const res = await getTasks(query);
  expect(res?.status).toBe(200);
  const body = (await res?.json()) as { id: string }[];
  return body.map((task) => task.id);
}
