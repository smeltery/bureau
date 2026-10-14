import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIntegrationStore } from "./store.ts";
import { testConnection } from "./connection-test.ts";

test("identity tests never follow redirects or return reflected credentials and transport errors", async () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-connection-test-"));
  const store = createIntegrationStore(root);
  const scope = { kind: "office" as const };
  const value = "private-service-credential";
  try {
    store.setSecret(scope, "GH_TOKEN", { value, hosts: ["api.github.com"], form: { kind: "authorization" } });
    const reflected = await testConnection(scope, "secrets", "GH_TOKEN", store, async (url, init) => {
      expect(url).toBe("https://api.github.com/user");
      expect(init.redirect).toBe("manual");
      expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${value}`);
      return Response.json({ login: Buffer.from(value).toString("base64") });
    });
    expect(reflected).toEqual({ ok: true, label: undefined });
    const redirected = await testConnection(scope, "secrets", "GH_TOKEN", store, async () => new Response(null, { status: 302, headers: { location: "https://other.example.test" } }));
    expect(redirected.ok).toBe(false);
    const failed = await testConnection(scope, "secrets", "GH_TOKEN", store, async () => {
      throw new Error(`The service returned ${value}`);
    });
    expect(JSON.stringify(failed)).not.toContain(value);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("MCP tests initialize once, carry the session header and count paginated tools", async () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-mcp-test-"));
  const store = createIntegrationStore(root);
  const scope = { kind: "office" as const };
  let page = 0;
  try {
    store.setMcp(scope, "docs", { url: "https://example.test/mcp" });
    const result = await testConnection(scope, "mcp", "docs", store, async (_url, init) => {
      const body = JSON.parse(String(init.body));
      if (body.method === "initialize")
        return Response.json({ jsonrpc: "2.0", id: 1, result: { capabilities: { tools: {} }, serverInfo: { name: "Documentation" } } }, { headers: { "mcp-session-id": "session" } });
      expect(new Headers(init.headers).get("mcp-session-id")).toBe("session");
      if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
      page++;
      if (page === 1) return Response.json({ result: { tools: [{ name: "read" }], nextCursor: "next" } });
      expect(body.params.cursor).toBe("next");
      return new Response('data: {"result":{"tools":[{"name":"search"}]}}\n\n', { headers: { "content-type": "text/event-stream" } });
    });
    expect(result).toEqual({ ok: true, label: "Documentation", tools: 2 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
