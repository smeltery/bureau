import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, readdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIntegrationStore } from "../store.ts";
import { createOAuthStore, oauthAccessToken, type McpOAuthRecord } from "./store.ts";
import { refreshMcpOAuthRecord } from "./runtime.ts";

test("refresh replaces access tokens but cannot revive a signed-out or replaced registration", async () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-oauth-refresh-"));
  const registrations = createIntegrationStore(root);
  const storage = createOAuthStore(root);
  const scope = { kind: "office" as const };
  const server = registrations.setMcp(scope, "docs", { url: "https://tools.example.test/mcp", oauth: true });
  const record: McpOAuthRecord = {
    scope,
    name: server.name,
    url: server.url,
    createdAt: server.createdAt,
    registrationId: server.id,
    redirectUri: "http://localhost:4000/api/integrations/oauth/callback",
    client: { client_id: "test-client" },
    tokens: { access_token: "old-access-token", refresh_token: "private-refresh-token", token_type: "Bearer" },
    expiresAt: Date.now() + 1000,
    discovery: {
      authorizationServerUrl: "https://auth.example.test",
      authorizationServerMetadata: {
        issuer: "https://auth.example.test",
        authorization_endpoint: "https://auth.example.test/authorize",
        token_endpoint: "https://auth.example.test/token",
        response_types_supported: ["code"],
        token_endpoint_auth_methods_supported: ["none"],
      },
    },
  };
  let changes = 0;
  let signOutDuringRequest = false;
  const deps = {
    registrations,
    storage,
    changed: async () => {
      changes++;
    },
    send: (async (_url: unknown, init?: RequestInit) => {
      const form = new URLSearchParams(String(init?.body));
      expect(form.get("grant_type")).toBe("refresh_token");
      expect(form.get("refresh_token")).toBe("private-refresh-token");
      if (signOutDuringRequest) storage.remove(scope, server.name);
      return Response.json({ access_token: "new-access-token", token_type: "Bearer", expires_in: 3600 });
    }) as typeof fetch,
  };
  try {
    const memberRecord = { ...record, scope: { kind: "member" as const, userId: "a" } };
    storage.write(memberRecord);
    storage.write({ ...memberRecord, scope: { kind: "member", userId: "a-b" } });
    const directory = join(root, "integrations", "oauth");
    const memberFile = join(directory, readdirSync(directory).find((file) => /^member-a-[a-f0-9]{64}\.json$/.test(file))!);
    expect(statSync(memberFile).mode & 0o777).toBe(0o600);
    writeFileSync(memberFile, "corrupt");
    storage.removeMember("a");
    expect(existsSync(memberFile)).toBe(false);
    expect(storage.read({ kind: "member", userId: "a-b" }, server.name)).not.toBeNull();
    storage.write(record);
    await refreshMcpOAuthRecord(record, deps);
    expect(oauthAccessToken(scope, server, storage)).toBe("new-access-token");
    expect(storage.read(scope, server.name)?.tokens?.refresh_token).toBe("private-refresh-token");
    expect(changes).toBe(1);
    const nearExpiry = { ...storage.read(scope, server.name)!, expiresAt: Date.now() + 1000 };
    storage.write(nearExpiry);
    signOutDuringRequest = true;
    await refreshMcpOAuthRecord(nearExpiry, deps);
    expect(storage.read(scope, server.name)).toBeNull();
    expect(changes).toBe(1);
    storage.write(record);
    registrations.remove(scope, "mcp", server.name);
    registrations.setMcp(scope, "docs", { url: server.url, oauth: true });
    await refreshMcpOAuthRecord(record, deps);
    expect(storage.read(scope, server.name)).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
