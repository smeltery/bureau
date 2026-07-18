import { afterEach, describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { _testResetAgentTokens, mintAgentToken } from "../../agents/tokens.ts";
import { agents } from "../../agents/state.ts";
import { createManagedAgent } from "../../agents/managed-factory.ts";
import { handleAgentsRequest } from "../agents.ts";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";
import type { BackendSession } from "../../backends/types.ts";

afterEach(() => {
  _testResetAgentTokens();
  agents.clear();
});

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

const ownerAuth: AuthResult = {
  kind: "ok",
  session: {
    sessionIdHash: "hash",
    sessionPrefix: "sess",
    userId: "owner-1",
    username: "Owner",
    role: "owner",
    needsRolling: false,
  },
};

const memberAuth: AuthResult = {
  kind: "ok",
  session: {
    sessionIdHash: "hash",
    sessionPrefix: "sess",
    userId: "member-1",
    username: "Member",
    role: "member",
    needsRolling: false,
  },
};

function installAgentWithContext(id: string) {
  const info: AgentInfo = {
    id,
    name: "Context Agent",
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
  };
  const managed = createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] });
  managed.session = {
    async *stream() {},
    async getContextUsage() {
      return { model: "claude-sonnet", totalTokens: 42, maxTokens: 200, percentage: 21 };
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

describe("handleAgentsRequest", () => {
  test("lists the caller-visible agent discovery manifest", async () => {
    const req = request("/api/agents", { method: "GET" });

    const res = await handleAgentsRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual([]);
  });

  test("requires an authenticated caller for the agent discovery manifest", async () => {
    const req = request("/api/agents", { method: "GET" });

    const res = await handleAgentsRequest(req, new URL(req.url));

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "unauthenticated" });
  });

  test("rejects invalid bearer tokens on the agent discovery manifest", async () => {
    const req = request("/api/agents", {
      method: "GET",
      headers: { Authorization: "Bearer missing" },
    });

    const res = await handleAgentsRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "missing or invalid bearer token" });
  });

  test("accepts /api/agents affordance routes", async () => {
    const token = mintAgentToken("agent-1", "user-1");
    const req = request("/api/agents/agent-1/read-file", {
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ path: "plot.png" }),
    });

    const res = await handleAgentsRequest(req, new URL(req.url));

    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({ error: "agent not found" });
  });

  test("rejects retired legacy /agents affordance and message routes", async () => {
    const token = mintAgentToken("agent-1", "user-1");
    const endpoints = [
      { path: "/agents/agent-1/diff", body: {} },
      { path: "/agents/agent-1/edit-file", body: { path: "plot.png" } },
      { path: "/agents/agent-1/read-file", body: { path: "plot.png" } },
      { path: "/agents/agent-1/terminal-command", body: { command: "bun test" } },
      { path: "/agents/agent-1/message", body: { text: "hello", senderAgentId: "agent-1" } },
    ];

    for (const endpoint of endpoints) {
      const req = request(endpoint.path, {
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(endpoint.body),
      });
      const res = await handleAgentsRequest(req, new URL(req.url));

      expect(res).toBeNull();
    }
  });

  test("requires a bearer token before parsing the body", async () => {
    const req = request("/api/agents/agent-1/diff", {
      body: "not json",
    });

    const res = await handleAgentsRequest(req, new URL(req.url));

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "missing or invalid bearer token" });
  });

  test("rejects tokens for a different agent", async () => {
    const token = mintAgentToken("agent-2", "user-1");
    const req = request("/api/agents/agent-1/diff", {
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });

    const res = await handleAgentsRequest(req, new URL(req.url));

    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "token does not match agent" });
  });

  test("returns agent context usage to the owning bearer token", async () => {
    installAgentWithContext("agent-1");
    const token = mintAgentToken("agent-1", "user-1");
    const req = new Request("http://local.test/api/agents/agent-1/context", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await handleAgentsRequest(req, new URL(req.url));
    const body = await res?.json();

    expect(res?.status).toBe(200);
    expect(body).toMatchObject({
      available: true,
      model: "claude-sonnet",
      totalTokens: 42,
      maxTokens: 200,
      percentage: 21,
    });
    expect(typeof body.sampledAtMs).toBe("number");
  });

  test("requires matching bearer token for agent context usage", async () => {
    const token = mintAgentToken("agent-2", "user-1");
    const req = new Request("http://local.test/api/agents/agent-1/context", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await handleAgentsRequest(req, new URL(req.url));

    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "token does not match agent" });
  });

  test("rejects invalid bearer tokens on conversation message routes", async () => {
    const req = request("/api/agents/agent-1/messages", {
      headers: { Authorization: "Bearer missing" },
      body: JSON.stringify({ text: "hello" }),
    });

    const res = await handleAgentsRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "missing or invalid bearer token" });
  });

  test("rejects user-scope scheduled messages instead of sending immediately", async () => {
    const req = request("/api/agents/agent-1/messages", {
      body: JSON.stringify({ text: "later", deliverAt: "2026-07-14T18:30:00Z" }),
    });

    const res = await handleAgentsRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(400);
    expect(await res?.json()).toEqual({ error: "deliverAt is only supported for agent bearer messages" });
  });

  test("requires timezone-qualified RFC3339 for scheduled agent messages", async () => {
    const token = mintAgentToken("agent-1", "user-1");
    const req = request("/api/agents/agent-1/messages", {
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: "later", deliverAt: "2026-07-14T18:30:00" }),
    });

    const res = await handleAgentsRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(400);
    expect(await res?.json()).toEqual({ error: "deliverAt must be RFC3339 with a timezone" });
  });

  test("allows scheduled self-send past immediate self-send guard", async () => {
    const token = mintAgentToken("agent-1", "user-1");
    const soon = new Date(Date.now() + 60_000).toISOString();
    const req = request("/api/agents/agent-1/messages", {
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text: "future reminder", deliverAt: soon }),
    });

    const res = await handleAgentsRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(400);
    expect(await res?.json()).toEqual({ error: "sender agent is not known" });
  });

  test("requires matching bearer token to list scheduled outbox", async () => {
    const token = mintAgentToken("agent-2", "user-1");
    const req = new Request("http://local.test/api/agents/agent-1/scheduled-messages", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await handleAgentsRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "token does not match agent" });
  });

  test("handles conversation session routes under /api/agents", async () => {
    const req = new Request("http://local.test/api/agents/missing/sessions");

    const res = await handleAgentsRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({ error: "agent not found" });
  });

  test("returns null for unrelated /api routes", async () => {
    const req = request("/api/tasks");

    await expect(handleAgentsRequest(req, new URL(req.url))).resolves.toBeNull();
  });

  test("requires a browser session to spawn agents", async () => {
    const req = request("/api/agents", {
      body: JSON.stringify({ name: "A", cwd: process.cwd(), roomId: "room-1", desk: 0 }),
    });

    const res = await handleAgentsRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "unauthenticated" });
  });

  test("validates spawn bodies before creating agents", async () => {
    const req = request("/api/agents", {
      body: JSON.stringify({ cwd: process.cwd(), roomId: "room-1", desk: 0 }),
    });

    const res = await handleAgentsRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(422);
    expect(await res?.json()).toEqual({ error: "name is required" });
  });

  test("routes agent lifecycle mutations under /api/agents", async () => {
    const req = request("/api/agents/missing/abort", { body: JSON.stringify({}) });

    const res = await handleAgentsRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({ error: "agent not found" });
  });

  test("requires owners for privilege changes", async () => {
    const req = request("/api/agents/missing/privileged", {
      method: "PUT",
      body: JSON.stringify({ privileged: true }),
    });

    const res = await handleAgentsRequest(req, new URL(req.url), memberAuth);

    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({ error: "agent not found" });
  });
});
