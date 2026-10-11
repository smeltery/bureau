import { expect, test, spyOn } from "bun:test";
import { handleTasksRequest } from "../http/tasks.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { taskStore } from "./store.ts";

const owner: AuthResult = {
  kind: "ok",
  session: { userId: "history-owner", username: "Owner", role: "owner", sessionIdHash: "h", sessionPrefix: "s", needsRolling: false, absoluteExpiresAt: Date.now() + 10000 },
};
async function call(method: string, path: string, body?: unknown, auth = owner) {
  const req = new Request(`http://localhost/api/tasks${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
  const response = (await handleTasksRequest(req, new URL(req.url), auth))!;
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}
test("task history and restore enforce owner access and rejected edits leave no changes", async () => {
  const created = (await call("POST", "", { title: "Recover this task" })).body;
  const rejected = await call("PATCH", `/${created.id}`, { title: "must not change", roomId: "missing-room" });
  expect(rejected.status).toBe(404);
  expect((await call("GET", `/${created.id}`)).body.title).toBe("Recover this task");
  expect((await call("GET", `/${created.id}/history`)).body.entries).toHaveLength(1);
  await call("PATCH", `/${created.id}`, { status: "done" });
  await call("DELETE", `/${created.id}`);
  const member: AuthResult = { ...owner, session: { ...owner.session, role: "member" } };
  expect((await call("POST", `/${created.id}/restore`, undefined, member)).status).toBe(403);
  expect((await call("GET", "/deleted", undefined, member)).status).toBe(403);
  expect((await call("GET", "/deleted")).body.tasks.some((task: { id: string }) => task.id === created.id)).toBe(true);
  expect((await call("POST", `/${created.id}/restore`)).body.status).toBe("done");
  expect((await call("POST", `/${created.id}/restore`)).status).toBe(409);
  expect(taskStore.read(created.id)?.history.map((entry) => entry.operation)).toEqual(["create", "update", "delete", "restore"]);
  expect((await call("GET", `/${created.id}/history?cursor=bad`)).status).toBe(400);
  await call("DELETE", `/${created.id}`);
});

test("failed persistence does not publish an edited task", async () => {
  const created = (await call("POST", "", { title: "Keep me" })).body;
  const write = spyOn(taskStore, "commit").mockImplementationOnce(() => {
    throw new Error("disk unavailable");
  });
  try {
    expect((await call("PATCH", `/${created.id}`, { title: "not saved" })).status).toBe(500);
    expect((await call("GET", `/${created.id}`)).body.title).toBe("Keep me");
    expect(taskStore.read(created.id)?.history).toHaveLength(1);
  } finally {
    write.mockRestore();
    await call("DELETE", `/${created.id}`);
  }
});
