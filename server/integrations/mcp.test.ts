import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIntegrationStore } from "./store.ts";
import { resolveMcpServers } from "./mcp.ts";
import { registerClaudeMcp } from "../backends/claude/mcp.ts";
import { bootstrapCodexThread } from "../backends/codex/session-bootstrap.ts";
import type { JsonRpcLiteClient } from "../backends/codex/client.ts";

test("member MCP registrations override office names and missing credentials fail closed", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-mcp-"));
  const store = createIntegrationStore(root);
  const office = { kind: "office" as const };
  const member = { kind: "member" as const, userId: "member-a" };
  try {
    store.setMcp(office, "docs", { url: "https://office.example.test/mcp" });
    store.setSecret(member, "TOKEN", { value: "private-service-token", hosts: ["personal.example.test"], form: { kind: "authorization" } });
    store.setMcp(member, "docs", { url: "https://personal.example.test/mcp", secret: "TOKEN" });
    expect(resolveMcpServers("member-a", store, () => "stand-in")).toEqual([{ name: "bureau-docs", url: "https://personal.example.test/mcp", headers: { Authorization: "Bearer stand-in" } }]);
    expect(resolveMcpServers("member-b", store, () => "stand-in")[0]!.url).toContain("office.example.test");
    expect(resolveMcpServers("member-a", store, () => null)).toEqual([]);
    store.setSecret(member, "TOKEN", { hosts: ["other.example.test"] });
    expect(resolveMcpServers("member-a", store, () => "stand-in")).toEqual([]);
    writeFileSync(join(root, "integrations/member-member-a.json"), "invalid");
    expect(resolveMcpServers("member-a", store, () => "stand-in")).toHaveLength(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Claude MCP control registration waits for completion and tolerates timeout without exposing errors", async () => {
  let resolve!: (value: { added: string[]; removed: string[]; errors: Record<string, string> }) => void;
  let registered: unknown;
  const pending = new Promise<{ added: string[]; removed: string[]; errors: Record<string, string> }>((done) => {
    resolve = done;
  });
  const query = {
    setMcpServers: (servers: unknown) => {
      registered = servers;
      return pending;
    },
  };
  let complete = false;
  const ready = registerClaudeMcp(query, [{ name: "bureau-docs", url: "https://example.test/mcp", headers: { Authorization: "Bearer stand-in" } }]).then(() => {
    complete = true;
  });
  expect(complete).toBe(false);
  expect(registered).toEqual({ "bureau-docs": { type: "http", url: "https://example.test/mcp", headers: { Authorization: "Bearer stand-in" } } });
  resolve({ added: ["bureau-docs"], removed: [], errors: {} });
  await ready;
  expect(complete).toBe(true);
  await registerClaudeMcp({ setMcpServers: () => new Promise(() => {}) }, [{ name: "slow", url: "https://example.test/mcp", headers: {} }], 5);
});

test("Codex sends scoped MCP configuration on both new and resumed threads", async () => {
  for (const resumeThreadId of [undefined, "existing-thread"]) {
    let sent: Record<string, any> | undefined;
    const client = {
      initialize: async () => {},
      request: async (_method: string, params: Record<string, unknown>) => {
        sent = params;
        return { thread: { id: "thread" } };
      },
    } as unknown as JsonRpcLiteClient;
    await bootstrapCodexThread(client, {
      agentId: "agent",
      cwd: "/tmp",
      systemPrompt: "test",
      modelFamily: "gpt-5",
      effort: "high",
      permissionMode: "never",
      resumeThreadId,
      mcpServers: [{ name: "bureau-docs", url: "https://example.test/mcp", headers: { Authorization: "Bearer stand-in" } }],
    });
    expect(sent?.config["mcp_servers.bureau-docs"]).toEqual({ url: "https://example.test/mcp", http_headers: { Authorization: "Bearer stand-in" } });
  }
});
