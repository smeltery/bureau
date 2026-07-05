import { afterEach, describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { _testResetAgentTokens, mintAgentToken } from "../../agents/tokens.ts";
import { handleAgentsRequest } from "../agents.ts";

afterEach(() => {
  _testResetAgentTokens();
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

describe("handleAgentsRequest", () => {
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

  test("keeps legacy /agents affordance routes working", async () => {
    const token = mintAgentToken("agent-1", "user-1");
    const req = request("/agents/agent-1/read-file", {
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ path: "plot.png" }),
    });

    const res = await handleAgentsRequest(req, new URL(req.url));

    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({ error: "agent not found" });
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

  test("rejects invalid bearer tokens on conversation message routes", async () => {
    const req = request("/api/agents/agent-1/messages", {
      headers: { Authorization: "Bearer missing" },
      body: JSON.stringify({ text: "hello" }),
    });

    const res = await handleAgentsRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "missing or invalid bearer token" });
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
