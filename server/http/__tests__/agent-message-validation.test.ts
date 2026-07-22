import { afterEach, describe, expect, test } from "bun:test";
import { _testResetAgentTokens, mintAgentToken } from "../../agents/tokens.ts";
import { agents } from "../../agents/state.ts";
import { handleAgentsRequest } from "../agents.ts";

afterEach(() => {
  _testResetAgentTokens();
  agents.clear();
});

function request(path: string, body: unknown, headers: HeadersInit = {}): Request {
  return new Request(`http://local.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("agent message validation", () => {
  test("rejects malformed client message ids", async () => {
    const req = request("/api/agents/agent-1/messages", { text: "hello", clientMessageId: 123 });

    const res = await handleAgentsRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(422);
    expect(await res?.json()).toEqual({ error: "clientMessageId must be a string" });
  });

  test("rejects non-string scheduled delivery times", async () => {
    const token = mintAgentToken("agent-1", "user-1");
    const req = request(
      "/api/agents/agent-1/messages",
      { text: "later", deliverAt: Date.now() + 60_000 },
      {
        Authorization: `Bearer ${token}`,
      },
    );

    const res = await handleAgentsRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(422);
    expect(await res?.json()).toEqual({ error: "deliverAt must be a string" });
  });
});
