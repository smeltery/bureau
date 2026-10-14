import { expect, test } from "bun:test";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { mintApiToken, resolveApiToken, revokeApiToken } from "../auth/api-tokens.ts";
import { mintAgentToken, revokeAgentToken } from "../agents/tokens.ts";
import { claimUserByName, deleteUserById } from "../users.ts";
import { handleIntegrationsRequest } from "./http.ts";
import { integrationStore } from "./store.ts";

test("integration APIs scope edits and reveals while agent host additions are refused", async () => {
  const owner = claimUserByName(`Integration owner ${crypto.randomUUID()}`, { role: "owner" });
  const member = claimUserByName(`Integration member ${crypto.randomUUID()}`, { role: "member" });
  const other = claimUserByName(`Integration other ${crypto.randomUUID()}`, { role: "member" });
  const ownerToken = await mintApiToken({ userId: owner.id, name: "Integrations", expiresInDays: 30 });
  const memberToken = await mintApiToken({ userId: member.id, name: "Integrations", expiresInDays: 30 });
  const agentId = `integration-${crypto.randomUUID()}`;
  const agentToken = mintAgentToken(agentId, member.id, true);
  async function call(token: string, path: string, method = "GET", body?: unknown) {
    const auth: AuthResult = resolveApiToken(token) ? { kind: "api", token: resolveApiToken(token)! } : { kind: "loopback" };
    const req = new Request(`http://localhost/api/integrations/${path}`, { method, headers: { Authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return (await handleIntegrationsRequest(req, new URL(req.url), auth))!;
  }
  const own = `members/${member.id}`;
  const secret = { value: "private-member-value", hosts: ["api.example.com"], form: { kind: "authorization" } };
  try {
    expect((await call(memberToken.token, `${own}/secrets/TOKEN`, "PUT", secret)).status).toBe(200);
    expect(JSON.stringify(await (await call(memberToken.token, own)).json())).not.toContain(secret.value);
    expect((await call(memberToken.token, `members/${other.id}`)).status).toBe(404);
    expect((await call(ownerToken.token, `${own}/secrets/TOKEN/reveal`)).status).toBe(403);
    expect((await call(agentToken, `${own}/secrets/TOKEN/reveal`)).status).toBe(403);
    expect(await (await call(memberToken.token, `${own}/secrets/TOKEN/reveal`)).json()).toEqual({ value: secret.value });
    expect((await call(agentToken, `${own}/secrets/TOKEN`, "PUT", { hosts: ["api.example.com", "other.example.com"] })).status).toBe(403);
    expect((await call(agentToken, `${own}/secrets/TOKEN`, "PUT", { note: "Use for project tools." })).status).toBe(200);
    const generation = integrationStore.privateSecrets({ kind: "member", userId: member.id })[0]!.generation;
    expect((await call(memberToken.token, `${own}/secrets/TOKEN/reissue`, "POST")).status).toBe(200);
    expect(integrationStore.privateSecrets({ kind: "member", userId: member.id })[0]!.generation).not.toBe(generation);
    expect((await call(memberToken.token, `office/secrets/TOKEN`, "PUT", secret)).status).toBe(404);
    deleteUserById(member.id);
    expect(integrationStore.list({ kind: "member", userId: member.id }).secrets).toEqual([]);
  } finally {
    revokeAgentToken(agentId);
    await revokeApiToken(owner.id, ownerToken.apiToken.id);
    await revokeApiToken(member.id, memberToken.apiToken.id);
    for (const user of [owner, member, other]) deleteUserById(user.id);
  }
});
