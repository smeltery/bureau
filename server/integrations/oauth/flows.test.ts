import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createIntegrationStore } from "../store.ts";
import { createOAuthStore, oauthAccessToken } from "./store.ts";
import { createOAuthFlows } from "./flows.ts";
import { oauthFetch, validateDiscovery } from "./provider.ts";

test("MCP sign-in uses discovery, PKCE and member-bound single-use callbacks", async () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-mcp-oauth-"));
  const registrations = createIntegrationStore(root);
  const storage = createOAuthStore(root);
  const scope = { kind: "member" as const, userId: "member-a" };
  const server = registrations.setMcp(scope, "docs", { url: "https://tools.example.test/mcp", oauth: true });
  let challenge = "";
  const send = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    expect(init?.redirect).toBe("manual");
    if (url === server.url)
      return new Response(null, { status: 401, headers: { "www-authenticate": 'Bearer resource_metadata="https://tools.example.test/.well-known/oauth-protected-resource", scope="tools:read"' } });
    if (url.includes("oauth-protected-resource")) return Response.json({ resource: server.url, authorization_servers: ["https://auth.example.test"], scopes_supported: ["tools:read"] });
    if (url.includes(".well-known"))
      return Response.json({
        issuer: "https://auth.example.test",
        authorization_endpoint: "https://auth.example.test/authorize",
        token_endpoint: "https://auth.example.test/token",
        registration_endpoint: "https://auth.example.test/register",
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    if (url.endsWith("/register")) return Response.json({ client_id: "registered-client", redirect_uris: ["http://localhost:4000/api/integrations/oauth/callback"] }, { status: 201 });
    if (url.endsWith("/token")) {
      const form = new URLSearchParams(String(init?.body));
      expect(form.get("resource")).toBe(server.url);
      expect(createHash("sha256").update(form.get("code_verifier")!).digest("base64url")).toBe(challenge);
      return Response.json({ access_token: "private-access-token", refresh_token: "private-refresh-token", token_type: "Bearer", expires_in: 3600 });
    }
    throw new Error("Unexpected OAuth test request.");
  }) as typeof fetch;
  const flows = createOAuthFlows(registrations, storage, send);
  try {
    const authorization = new URL(await flows.start(scope, server, "member-a", "http://localhost:4000/api/integrations/oauth/callback", {}, () => true));
    expect(authorization.origin).toBe("https://auth.example.test");
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    challenge = authorization.searchParams.get("code_challenge")!;
    const state = authorization.searchParams.get("state")!;
    await expect(flows.finish(state, "member-b", "code", false, () => true)).rejects.toThrow("same Bureau member");
    await expect(flows.finish(state, "member-a", "code", false, () => false)).rejects.toThrow("same Bureau member");
    await expect(flows.start(scope, server, "member-a", "http://localhost:4000/api/integrations/oauth/callback", {}, () => false)).rejects.toThrow("changed");
    expect(storage.read(scope, server.name)).toBeNull();
    await flows.finish(state, "member-a", "code", false, () => true);
    expect(oauthAccessToken(scope, server, storage)).toBe("private-access-token");
    expect(JSON.stringify(registrations.list(scope))).not.toContain("private-access-token");
    await expect(flows.finish(state, "member-a", "code", false, () => true)).rejects.toThrow("already used");
    const next = new URL(await flows.start(scope, server, "member-a", "http://localhost:4000/api/integrations/oauth/callback", {}, () => true));
    registrations.remove(scope, "mcp", "docs");
    registrations.setMcp(scope, "docs", { url: server.url, oauth: true });
    await expect(flows.finish(next.searchParams.get("state")!, "member-a", "code", false, () => true)).rejects.toThrow("changed");
    flows.cancel(scope, server.name);
    expect(storage.read(scope, server.name)).toBeNull();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("OAuth network boundary rejects insecure endpoints, redirects and oversized responses", async () => {
  let requests = 0;
  const send = (async () => {
    requests++;
    return new Response(null, { status: 302, headers: { location: "https://elsewhere.example.test" } });
  }) as unknown as typeof fetch;
  const request = oauthFetch(AbortSignal.timeout(1000), send);
  await expect(request("http://auth.example.test/token")).rejects.toThrow("HTTPS");
  expect(requests).toBe(0);
  await expect(request("https://auth.example.test/token")).rejects.toThrow("redirected");
  expect(requests).toBe(1);
  const oversized = oauthFetch(AbortSignal.timeout(1000), (async () => new Response("x".repeat(1024 * 1024 + 1))) as unknown as typeof fetch);
  await expect(oversized("https://auth.example.test/metadata")).rejects.toThrow("size limit");
});

test("OAuth metadata must identify the configured resource and authorization issuer", () => {
  const metadata = {
    issuer: "https://auth.example.test",
    authorization_endpoint: "https://auth.example.test/authorize",
    token_endpoint: "https://auth.example.test/token",
    response_types_supported: ["code"],
  };
  expect(() => validateDiscovery({ authorizationServerUrl: "https://different.example.test", authorizationServerMetadata: metadata }, "https://tools.example.test/mcp")).toThrow("identity");
  expect(() =>
    validateDiscovery(
      { authorizationServerUrl: "https://auth.example.test", authorizationServerMetadata: metadata, resourceMetadata: { resource: "https://other.example.test/mcp" } },
      "https://tools.example.test/mcp",
    ),
  ).toThrow("another MCP resource");
  expect(() =>
    validateDiscovery(
      { authorizationServerUrl: "https://auth.example.test", authorizationServerMetadata: { ...metadata, token_endpoint: "http://auth.example.test/token" } },
      "https://tools.example.test/mcp",
    ),
  ).toThrow("HTTPS");
});
