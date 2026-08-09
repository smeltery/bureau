import { afterEach, describe, expect, test } from "bun:test";
import { createManagedAgent } from "../../agents/managed-factory.ts";
import { agents } from "../../agents/state.ts";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";
import * as AgentManager from "../../agent-manager.ts";
import { claimUserByName, deleteUserById, updateUserById } from "../../users.ts";
import { handleAgentsRequest } from "../agents.ts";

type BrowserAuth = Extract<AuthResult, { kind: "ok" }>;

const createdUserIds: string[] = [];

afterEach(() => {
  agents.clear();
  for (const userId of createdUserIds.splice(0)) deleteUserById(userId);
});

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://local.test${path}`, {
    method: "PUT",
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

function memberAuth(label: string): BrowserAuth {
  const user = claimUserByName(`${label} ${crypto.randomUUID()}`, { role: "member" });
  createdUserIds.push(user.id);
  updateUserById(user.id, { allowedRooms: [AgentManager.getRooms()[0]!.id] });
  return {
    kind: "ok",
    session: {
      sessionIdHash: `${user.id}-hash`,
      sessionPrefix: user.id,
      userId: user.id,
      username: user.name,
      role: "member",
      needsRolling: false,
      absoluteExpiresAt: Date.now() + 86_400_000,
    },
  };
}

function installAgent(id: string, userId: string): void {
  const info: AgentInfo = {
    id,
    name: "Managed Agent",
    desk: 0,
    room: 0,
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
    userId,
  };
  agents.set(id, createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] }));
}

describe("agent privilege management", () => {
  test("allows the agent manager to change privilege", async () => {
    const auth = memberAuth("Member Manager");
    installAgent("agent-1", auth.session.userId);

    const res = await handleAgentsRequest(request("/api/agents/agent-1/privileged", { body: JSON.stringify({ privileged: true }) }), new URL("http://local.test/api/agents/agent-1/privileged"), auth);

    expect(res?.status).toBe(200);
    expect(res).not.toBeNull();
    const body = await res!.json();
    expect(body.agent.privileged).toBe(true);
  });

  test("rejects non-manager members for privilege changes", async () => {
    const manager = memberAuth("Privilege Manager");
    const other = memberAuth("Other Member");
    installAgent("agent-1", manager.session.userId);

    const res = await handleAgentsRequest(request("/api/agents/agent-1/privileged", { body: JSON.stringify({ privileged: true }) }), new URL("http://local.test/api/agents/agent-1/privileged"), other);

    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "owner or manager access required" });
  });
});
