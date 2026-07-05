import { afterEach, describe, expect, test } from "bun:test";
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

  test("returns null for unrelated /api routes", async () => {
    const req = request("/api/tasks");

    await expect(handleAgentsRequest(req, new URL(req.url))).resolves.toBeNull();
  });
});
