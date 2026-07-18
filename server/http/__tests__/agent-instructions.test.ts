import { afterEach, describe, expect, test } from "bun:test";
import { _testResetAgentTokens, mintAgentToken } from "../../agents/tokens.ts";
import { agents } from "../../agents/state.ts";
import { createManagedAgent } from "../../agents/managed-factory.ts";
import { handleAgentsRequest } from "../agents.ts";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";

afterEach(() => {
  _testResetAgentTokens();
  agents.clear();
});

function installAgent(id: string, overrides: Partial<AgentInfo> = {}) {
  const info: AgentInfo = {
    id,
    name: "Instruction Agent",
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
    ...overrides,
  };
  agents.set(id, createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] }));
}

describe("agent instructions read route", () => {
  test("returns agent custom instructions to that agent's bearer token", async () => {
    installAgent("agent-1", { customInstructions: "Prefer short answers." });
    const token = mintAgentToken("agent-1", null);
    const req = new Request("http://local.test/api/agents/agent-1/instructions", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await handleAgentsRequest(req, new URL(req.url));

    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ customInstructions: "Prefer short answers." });
  });

  test("returns null custom instructions through the instructions read route", async () => {
    installAgent("agent-1");
    const token = mintAgentToken("agent-1", null);
    const req = new Request("http://local.test/api/agents/agent-1/instructions", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await handleAgentsRequest(req, new URL(req.url));

    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ customInstructions: null });
  });

  test("requires a valid bearer token for the instructions read route", async () => {
    installAgent("agent-1");
    const req = new Request("http://local.test/api/agents/agent-1/instructions", {
      headers: { Authorization: "Bearer missing" },
    });

    const res = await handleAgentsRequest(req, new URL(req.url));

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "missing or invalid bearer token" });
  });
});
