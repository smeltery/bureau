import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";
import { createManagedAgent } from "../../agents/managed-factory.ts";
import { agents } from "../../agents/state.ts";
import { _testResetAgentTokens, mintAgentToken } from "../../agents/tokens.ts";
import * as AgentManager from "../../agent-manager.ts";
import { handleTasksRequest } from "../tasks.ts";

afterEach(() => {
  _testResetAgentTokens();
  agents.clear();
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

async function postTask(token: string, body: Record<string, unknown>): Promise<{ id: string; roomId?: string }> {
  const req = new Request("http://local.test/api/tasks", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const res = await handleTasksRequest(req, new URL(req.url));
  expect(res?.status).toBe(201);
  return (await res?.json()) as { id: string; roomId?: string };
}

async function deleteTask(taskId: string, token: string): Promise<void> {
  const req = new Request(`http://local.test/api/tasks/${taskId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  await handleTasksRequest(req, new URL(req.url));
}
