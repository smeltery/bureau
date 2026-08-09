import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";
import { createManagedAgent } from "../../agents/managed-factory.ts";
import { agents } from "../../agents/state.ts";
import { _testResetAgentTokens } from "../../agents/tokens.ts";
import type { BackendSession } from "../../backends/types.ts";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { handleAgentsRequest } from "../agents.ts";

afterEach(() => {
  _testResetAgentTokens();
  agents.clear();
});

const ownerAuth: AuthResult = {
  kind: "ok",
  session: {
    sessionIdHash: "hash",
    sessionPrefix: "sess",
    userId: "owner-1",
    username: "Owner",
    role: "owner",
    needsRolling: false,
    absoluteExpiresAt: Date.now() + 86_400_000,
  },
};

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://local.test${path}`, {
    method: "POST",
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

function installAgent(id: string) {
  const info: AgentInfo = {
    id,
    name: "Gap Agent",
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
    effort: "high",
  };
  const managed = createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] });
  managed.session = {
    async *stream() {},
    async getContextUsage() {
      return null;
    },
    async send() {},
    async approve() {},
    async abort() {},
    canAbortInPlace() {
      return false;
    },
    close() {},
  } satisfies BackendSession;
  agents.set(id, managed);
}

describe("agent route gap regressions", () => {
  test("includes thinking effort in the agent discovery manifest", async () => {
    installAgent("agent-1");
    const req = request("/api/agents", { method: "GET" });

    const res = await handleAgentsRequest(req, new URL(req.url), { kind: "loopback" });
    const body = (await res?.json()) as { id: string; effort?: string }[];

    expect(res?.status).toBe(200);
    expect(body).toEqual([expect.objectContaining({ id: "agent-1", effort: "high" })]);
  });

  test("rejects malformed attachment entries on conversation message routes", async () => {
    installAgent("agent-1");
    const req = request("/api/agents/agent-1/messages", {
      body: JSON.stringify({ text: "hello", attachments: [{ filename: "", originalName: "plot.png", mediaType: "image/png", size: 0 }] }),
    });

    const res = await handleAgentsRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(422);
    expect(await res?.json()).toEqual({ error: "attachments must contain filename, originalName, mediaType strings and nonnegative integer size" });
  });

  test("rejects spawn requests for invalid desks", async () => {
    const req = request("/api/agents", {
      body: JSON.stringify({ name: "A", cwd: process.cwd(), roomId: "room-1", desk: 8 }),
    });

    const res = await handleAgentsRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(422);
    expect(await res?.json()).toEqual({ error: "desk must be an integer from 0 to 7" });
  });
});
