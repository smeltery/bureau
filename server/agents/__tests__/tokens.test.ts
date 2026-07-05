import { afterEach, describe, expect, test } from "bun:test";
import { _testResetAgentTokens, getAgentToken, mintAgentToken, readBearerToken, resolveAgentToken, revokeAgentToken } from "../tokens.ts";

afterEach(() => {
  _testResetAgentTokens();
});

describe("agent bearer tokens", () => {
  test("minted tokens resolve to their agent and user", () => {
    const raw = mintAgentToken("agent-1", "user-1");

    expect(getAgentToken("agent-1")).toBe(raw);
    expect(resolveAgentToken(raw)).toEqual({ agentId: "agent-1", userId: "user-1", privileged: false });
  });

  test("minting rotates the previous token", () => {
    const first = mintAgentToken("agent-1", "user-1");
    const second = mintAgentToken("agent-1", "user-1");

    expect(second).not.toBe(first);
    expect(resolveAgentToken(first)).toBeNull();
    expect(resolveAgentToken(second)).toEqual({ agentId: "agent-1", userId: "user-1", privileged: false });
  });

  test("minted tokens carry privileged metadata", () => {
    const raw = mintAgentToken("agent-1", "user-1", true);

    expect(resolveAgentToken(raw)).toEqual({ agentId: "agent-1", userId: "user-1", privileged: true });
  });

  test("revoking removes a token", () => {
    const raw = mintAgentToken("agent-1", null);

    revokeAgentToken("agent-1");

    expect(getAgentToken("agent-1")).toBeNull();
    expect(resolveAgentToken(raw)).toBeNull();
  });

  test("readBearerToken parses bearer authorization headers", () => {
    const req = new Request("http://local.test/", {
      headers: { authorization: "Bearer abc123" },
    });

    expect(readBearerToken(req)).toBe("abc123");
  });
});
