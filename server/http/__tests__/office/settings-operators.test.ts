import { expect, test } from "bun:test";
import * as AgentManager from "../../../agent-manager.ts";
import { mintApiToken, resolveApiToken, revokeApiToken } from "../../../auth/api-tokens.ts";
import { revokeAgentToken } from "../../../agents/tokens.ts";
import type { AuthResult } from "../../../auth/auth-middleware.ts";
import { handleOfficeSettingsRequest } from "../../office-settings.ts";
import { bearerRequest, OWNER_OPERATOR_AGENT, setupPrivilegedFixture, teardownPrivilegedFixture } from "../privileged-agent-fixture.ts";

test("owner operators and personal tokens edit only versioned office settings", async () => {
  const fixture = setupPrivilegedFixture();
  const original = AgentManager.getOfficeSettings();
  const ownerToken = await mintApiToken({ userId: fixture.ownerManager.id, name: "Office", expiresInDays: 30 });
  async function call(token: string, auth: AuthResult, body?: unknown) {
    const req = bearerRequest("/api/office/settings", token, { method: body ? "PUT" : "GET", ...(body ? { body: JSON.stringify(body) } : {}) });
    return (await handleOfficeSettingsRequest(req, new URL(req.url), auth))!;
  }
  const agentAuth: AuthResult = { kind: "loopback" };
  const apiAuth: AuthResult = { kind: "api", token: resolveApiToken(ownerToken.token)! };
  try {
    expect((await call(fixture.plainToken, agentAuth)).status).toBe(403);
    expect((await call(fixture.privilegedToken, agentAuth)).status).toBe(403);
    const read = await call(fixture.ownerPrivilegedToken, agentAuth);
    expect(read.status).toBe(200);
    const settings = await read.json();
    expect(settings).not.toHaveProperty("envFile");
    expect(settings).not.toHaveProperty("previewAllowHosts");
    expect((await call(fixture.ownerPrivilegedToken, agentAuth, { version: settings.version, prompt: "Recoverable office instructions" })).status).toBe(204);
    expect((await call(ownerToken.token, apiAuth, { version: settings.version, prompt: "Stale" })).status).toBe(409);
    const current = await (await call(ownerToken.token, apiAuth)).json();
    expect((await call(ownerToken.token, apiAuth, { version: current.version, officeName: "Team office" })).status).toBe(204);
    expect(AgentManager.getOfficeSettings().prompt).toBe("Recoverable office instructions");
    expect(AgentManager.getOfficeSettings().officeName).toBe("Team office");
    const latest = await (await call(ownerToken.token, apiAuth)).json();
    expect((await call(ownerToken.token, apiAuth, { version: latest.version, envFile: "/private" })).status).toBe(400);
    expect((await call(ownerToken.token, apiAuth, { version: latest.version, prompt: null })).status).toBe(204);
    expect(AgentManager.getOfficeSettings().prompt).toBeNull();
    await revokeApiToken(fixture.ownerManager.id, ownerToken.apiToken.id);
    expect((await call(ownerToken.token, apiAuth)).status).toBe(403);
    revokeAgentToken(OWNER_OPERATOR_AGENT);
    expect((await call(fixture.ownerPrivilegedToken, agentAuth)).status).toBe(403);
  } finally {
    AgentManager.setOfficeSettings(original.prompt, original.envFile, original.experimental, original.receptionistAgentId, original.memberUsageCap, original.memberUsageShare, original.officeName);
    await revokeApiToken(fixture.ownerManager.id, ownerToken.apiToken.id);
    teardownPrivilegedFixture(fixture);
  }
});
