import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { agents } from "../../agents/state.ts";
import { mintAgentToken } from "../../agents/tokens.ts";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { handleAgentsRequest } from "../agents.ts";
import { bearerRequest, setupPrivilegedFixture, TARGET_AGENT, teardownPrivilegedFixture, type PrivilegedFixture } from "./privileged-agent-fixture.ts";

const noSession: AuthResult = { kind: "loopback" };

let fixture: PrivilegedFixture;

beforeEach(() => {
  fixture = setupPrivilegedFixture();
});

afterEach(() => {
  teardownPrivilegedFixture(fixture);
});

function agentRoute(path: string, token: string, init: RequestInit = {}): Promise<Response | null> {
  const req = bearerRequest(path, token, init);
  return handleAgentsRequest(req, new URL(req.url), undefined);
}

describe("POST /api/agents/:id/handoff", () => {
  test("lets an agent hand off itself with its bearer token", async () => {
    const selfToken = mintAgentToken(TARGET_AGENT, fixture.manager.id, false);
    const res = await agentRoute(`/api/agents/${TARGET_AGENT}/handoff`, selfToken, {
      body: JSON.stringify({ text: "Continue from step 3." }),
    });
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ ok: true });
  });

  test("lets a privileged operator hand off a visible agent", async () => {
    const res = await agentRoute(`/api/agents/${TARGET_AGENT}/handoff`, fixture.privilegedToken, {
      body: JSON.stringify({ text: "Wrap up the migration." }),
    });
    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ ok: true });
  });

  test("rejects an agent trying to hand off another agent", async () => {
    const res = await agentRoute(`/api/agents/${TARGET_AGENT}/handoff`, fixture.plainToken, {
      body: JSON.stringify({ text: "not allowed" }),
    });
    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "forbidden" });
    expect(agents.get(TARGET_AGENT)?.messageQueue.length ?? 0).toBe(0);
  });

  test("requires non-empty text", async () => {
    const res = await agentRoute(`/api/agents/${TARGET_AGENT}/handoff`, fixture.privilegedToken, {
      body: JSON.stringify({ text: "" }),
    });
    expect(res?.status).toBe(422);
    expect(await res?.json()).toEqual({ error: "text is required" });
    expect(agents.get(TARGET_AGENT)?.messageQueue.length ?? 0).toBe(0);
  });
});
