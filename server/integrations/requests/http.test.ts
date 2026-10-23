import { expect, test } from "bun:test";
import { setupPrivilegedFixture, teardownPrivilegedFixture, PLAIN_AGENT } from "../../http/__tests__/privileged-agent-fixture.ts";
import { mintApiToken, resolveApiToken, revokeApiToken } from "../../auth/api-tokens.ts";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { agents, logCache } from "../../agents/state.ts";
import { handleSecretRequests } from "./http.ts";

test("agent bearers can request but cannot answer, and owners cannot answer another member's request", async () => {
  const fixture = setupPrivilegedFixture();
  agents.get(PLAIN_AGENT)!.info.state = "stopped";
  const manager = await mintApiToken({ userId: fixture.manager.id, name: "Request test", expiresInDays: 30 });
  const owner = await mintApiToken({ userId: fixture.ownerManager.id, name: "Request test", expiresInDays: 30 });
  async function call(token: string, path: string, method: string, body?: unknown) {
    const auth: AuthResult = resolveApiToken(token) ? { kind: "api", token: resolveApiToken(token)! } : { kind: "loopback" };
    const req = new Request(`http://localhost/api/integrations/requests${path}`, { method, headers: { Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return (await handleSecretRequests(req, new URL(req.url), auth))!;
  }
  try {
    const created = await call(fixture.plainToken, "", "POST", { name: "REQUEST_TEST_TOKEN", hosts: ["api.example.test"], reason: "Read project issues." });
    expect(created.status).toBe(200);
    const id = (await created.json()).requestId;
    expect((await call(fixture.plainToken, `/${id}`, "POST", { decline: true })).status).toBe(403);
    expect((await call(owner.token, `/${id}`, "POST", { decline: true })).status).toBe(403);
    expect(await (await call(fixture.plainToken, `/${id}`, "GET")).json()).toEqual({ status: "pending", canAnswer: false });
    const listFor = async (user: typeof fixture.manager) => {
      const req = new Request("http://localhost/api/integrations/requests");
      const auth = { kind: "ok", session: { userId: user.id } } as AuthResult;
      return (await (await handleSecretRequests(req, new URL(req.url), auth))!.json()).requests;
    };
    expect((await listFor(fixture.manager)).map((card: { id: string }) => card.id)).toContain(id);
    expect((await listFor(fixture.ownerManager)).map((card: { id: string }) => card.id)).not.toContain(id);
    expect((await call(manager.token, "", "GET")).status).toBe(401);
    const result = await call(manager.token, `/${id}`, "POST", { value: "private-value-never-in-transcript" });
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ status: "saved", delivered: false });
    expect((await listFor(fixture.manager)).map((card: { id: string }) => card.id)).not.toContain(id);
    expect(JSON.stringify(logCache.get(PLAIN_AGENT))).not.toContain("private-value-never-in-transcript");
  } finally {
    await revokeApiToken(fixture.manager.id, manager.apiToken.id);
    await revokeApiToken(fixture.ownerManager.id, owner.apiToken.id);
    teardownPrivilegedFixture(fixture);
  }
});
