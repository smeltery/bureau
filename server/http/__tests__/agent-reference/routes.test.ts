import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { _testResetAgentTokens, mintAgentToken } from "../../../agents/tokens.ts";
import { handleAgentsRequest } from "../../agents.ts";

beforeEach(_testResetAgentTokens);
afterEach(_testResetAgentTokens);

function request(path: string, token?: string): Request {
  return new Request(`http://local.test${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

describe("agent reference routes", () => {
  test("list topics for bearer tokens", async () => {
    const token = mintAgentToken("agent-1", "user-1");
    const req = request("/api/agent-reference", token);

    const res = await handleAgentsRequest(req, new URL(req.url));
    const body = await res?.json();

    expect(res?.status).toBe(200);
    expect(typeof body.version).toBe("string");
    expect(body.topics).toContainEqual({
      topic: "tasks",
      description: "Task board",
    });
    expect(body.topics.some((entry: { topic: string }) => entry.topic === "privileged-operations")).toBe(false);
  });

  test("show privileged topics only to privileged bearer tokens", async () => {
    const token = mintAgentToken("agent-1", "user-1", true);
    const req = request("/api/agent-reference", token);

    const res = await handleAgentsRequest(req, new URL(req.url));
    const body = await res?.json();

    expect(res?.status).toBe(200);
    expect(body.topics).toContainEqual({
      topic: "privileged-operations",
      description: "Privileged office operations",
    });
  });

  test("return reference markdown by topic", async () => {
    const token = mintAgentToken("agent-1", "user-1");
    const req = request("/api/agent-reference/tasks", token);

    const res = await handleAgentsRequest(req, new URL(req.url));
    const body = await res?.json();

    expect(res?.status).toBe(200);
    expect(body.topic).toBe("tasks");
    expect(body.markdown).toContain("GET /api/tasks");
  });

  test("require bearer auth", async () => {
    const req = request("/api/agent-reference");

    const res = await handleAgentsRequest(req, new URL(req.url));

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({
      error: "missing or invalid bearer token",
    });
  });
});
