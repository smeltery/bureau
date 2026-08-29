import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { createManagedAgent } from "../../agents/managed-factory.ts";
import { agents } from "../../agents/state.ts";
import { _testResetAgentTokens, mintAgentToken } from "../../agents/tokens.ts";
import * as AgentManager from "../../agent-manager.ts";
import { addCronjob } from "../../cronjobs/index.ts";
import { setCronjobDefinitions } from "../../cronjobs/cronjob-store.ts";
import { _testResetRunTokens, mintRunToken } from "../../cronjobs/tokens.ts";
import { claimUserByName, deleteUserById, updateUserById } from "../../users.ts";
import { handleTasksRequest } from "../tasks.ts";
import { tasks } from "../../ws/broadcast.ts";

const createdUserIds: string[] = [];
const createdRoomIds: string[] = [];

afterEach(() => {
  _testResetAgentTokens();
  _testResetRunTokens();
  agents.clear();
  setCronjobDefinitions([]);
  tasks.splice(0, tasks.length);
  for (const id of createdUserIds.splice(0)) deleteUserById(id);
  for (const id of createdRoomIds.splice(0)) AgentManager.closeRoom(id);
});

describe("handleTasksRequest agent tokens", () => {
  test("creates tasks in the agent room by default and allows explicit globals", async () => {
    const room = AgentManager.getRooms()[0]!;
    installAgent("task-agent", room.id);
    const token = mintAgentToken("task-agent", "user-1");

    const defaultRoom = await postTask(token, { title: "Agent room task" });
    const global = await postTask(token, { title: "Global task", roomId: "" });

    expect(defaultRoom.roomId).toBe(room.id);
    expect(global.roomId).toBeUndefined();

    await deleteTask(defaultRoom.id, token);
    await deleteTask(global.id, token);
  });

  test("an agent can see tasks in other rooms its manager can access", async () => {
    const manager = claimUserByName(`Task Mgr ${crypto.randomUUID()}`, { role: "member", allowedRooms: [] });
    createdUserIds.push(manager.id);
    const roomA = AgentManager.getRooms()[0]!;
    const roomBId = AgentManager.createRoom("Manager Room B");
    createdRoomIds.push(roomBId);
    expect(updateUserById(manager.id, { allowedRooms: [roomA.id, roomBId] }).ok).toBe(true);

    installAgent("acl-agent", roomA.id);
    const token = mintAgentToken("acl-agent", manager.id);
    const inB = await postTask(token, { title: "in B", roomId: roomBId });
    const listed = await listTasks(token);
    expect(listed.map((t) => t.id)).toContain(inB.id);
  });
});

describe("handleTasksRequest cron-run bearer", () => {
  test("lists and creates only global tasks attributed to the job name", async () => {
    const owner = claimUserByName(`Cron Tasks ${crypto.randomUUID()}`, { role: "owner", allowedRooms: [] });
    createdUserIds.push(owner.id);
    const roomId = AgentManager.createRoom("Cron Tasks Room");
    createdRoomIds.push(roomId);
    const auth: AuthResult = {
      kind: "ok",
      session: {
        sessionIdHash: "h",
        sessionPrefix: "s",
        userId: owner.id,
        username: owner.name,
        role: "owner",
        needsRolling: false,
        absoluteExpiresAt: Date.now() + 86_400_000,
      },
    };
    const roomTask = await createAsSession(auth, { title: "room task", roomId });
    const globalTask = await createAsSession(auth, { title: "global task", roomId: "" });

    const job = addCronjob({
      name: "Nightly Sweep",
      schedule: { type: "interval", minutes: 60 },
      prompt: "check",
      cwd: process.cwd(),
      modelFamily: "opus",
      permissionMode: "never",
      username: owner.name,
      userId: owner.id,
    });
    const token = mintRunToken(job.id, "run-1", owner.id);

    const listed = await listTasks(token);
    expect(listed.map((t) => t.id)).toContain(globalTask.id);
    expect(listed.map((t) => t.id)).not.toContain(roomTask.id);

    const created = await postTask(token, { title: "from the run" });
    expect(created.createdBy).toBe("Nightly Sweep");
    expect(created.roomId).toBeUndefined();

    expect((await postTaskRaw(token, { title: "named room", roomId })).status).toBe(404);
    expect((await deleteTaskRaw(globalTask.id, token)).status).toBe(403);
    expect(tasks.some((t) => t.id === globalTask.id)).toBe(true);
  });
});

function installAgent(id: string, roomId: string): void {
  const info: AgentInfo = {
    id,
    name: "Task Agent",
    desk: 0,
    room: AgentManager.getRooms().findIndex((room) => room.id === roomId),
    cwd: process.cwd(),
    outfit: { hat: "none", color: "#000000", hair: "#000000", hairStyle: "short", skin: "#000000", beard: "none", accessory: null },
    permissionMode: "default",
    modelFamily: "sonnet",
    agentType: "claude",
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "idle",
    topic: null,
    topicStale: false,
    customInstructions: null,
  };
  agents.set(id, createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] }));
}

async function createAsSession(auth: AuthResult, body: Record<string, unknown>) {
  const req = new Request("http://local.test/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await handleTasksRequest(req, new URL(req.url), auth);
  expect(res?.status).toBe(201);
  return (await res!.json()) as { id: string; roomId?: string; createdBy: string };
}

async function listTasks(token: string) {
  const req = new Request("http://local.test/api/tasks", { headers: { Authorization: `Bearer ${token}` } });
  const res = await handleTasksRequest(req, new URL(req.url));
  expect(res?.status).toBe(200);
  return (await res!.json()) as { id: string }[];
}

async function postTask(token: string, body: Record<string, unknown>): Promise<{ id: string; roomId?: string; createdBy: string }> {
  const res = await postTaskRaw(token, body);
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; roomId?: string; createdBy: string };
}

async function postTaskRaw(token: string, body: Record<string, unknown>) {
  const req = new Request("http://local.test/api/tasks", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await handleTasksRequest(req, new URL(req.url)))!;
}

async function deleteTask(taskId: string, token: string): Promise<void> {
  await deleteTaskRaw(taskId, token);
}

async function deleteTaskRaw(taskId: string, token: string) {
  const req = new Request(`http://local.test/api/tasks/${taskId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  return (await handleTasksRequest(req, new URL(req.url)))!;
}
