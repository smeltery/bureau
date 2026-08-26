import { afterEach, describe, expect, test } from "bun:test";
import { _testResetAgentTokens, mintAgentToken } from "../../agents/tokens.ts";
import { agents } from "../../agents/state.ts";
import { createManagedAgent } from "../../agents/managed-factory.ts";
import { editAgent } from "../../agents/settings.ts";
import { handleAgentsRequest } from "../agents.ts";
import { testAgentInfo } from "../../__tests__/agent-info-fixture.ts";
import { versionOf } from "../../memory-store.ts";

afterEach(() => {
  _testResetAgentTokens();
  agents.clear();
});

function installAgent(id: string, overrides: Partial<ReturnType<typeof testAgentInfo>> = {}) {
  const info = testAgentInfo({ id, name: "Instruction Agent", ...overrides });
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
    expect(await res?.json()).toEqual({
      customInstructions: "Prefer short answers.",
      customInstructionsVersion: versionOf("Prefer short answers."),
    });
  });

  test("returns null custom instructions through the instructions read route", async () => {
    installAgent("agent-1");
    const token = mintAgentToken("agent-1", null);
    const req = new Request("http://local.test/api/agents/agent-1/instructions", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await handleAgentsRequest(req, new URL(req.url));

    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ customInstructions: null, customInstructionsVersion: versionOf("") });
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

describe("customInstructionsVersion guard", () => {
  test("returns 409 when the version is stale", async () => {
    installAgent("agent-1", { customInstructions: "v1" });
    const req = new Request("http://local.test/api/agents/agent-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customInstructions: "v2", customInstructionsVersion: "deadbeef0000" }),
    });

    const res = await handleAgentsRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(409);
    expect(await res?.json()).toEqual({ error: "custom instructions changed since you read them; re-read and retry" });
  });

  test("bumps the version on a successful instructions write", async () => {
    installAgent("agent-1", { customInstructions: "v1" });
    const before = versionOf("v1");
    await editAgent("agent-1", { customInstructions: "v2", customInstructionsVersion: before });
    expect(agents.get("agent-1")?.info.customInstructions).toBe("v2");
    expect(agents.get("agent-1")?.info.customInstructionsVersion).toBe(versionOf("v2"));
  });
});
