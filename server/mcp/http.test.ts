import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function isolated(script: string) {
  const home = mkdtempSync(join(tmpdir(), "bureau-office-mcp-"));
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
      import { expect } from "bun:test";
      import { handleOfficeMcp } from "./server/mcp/http.ts";
      import { callOfficeTool } from "./server/mcp/actions.ts";
      import { setupPrivilegedFixture, TARGET_AGENT, HIDDEN_AGENT } from "./server/http/__tests__/privileged-agent-fixture.ts";
      import { agents } from "./server/agents/state.ts";
      import { mintApiToken, revokeApiToken, enqueueApiTokenInboxMessage } from "./server/auth/api-tokens.ts";
      import { updateUserById, deleteUserById } from "./server/users.ts";
      import { appendLog } from "./server/persistence/logs/logs.ts";
      const fixture = setupPrivilegedFixture();
      const minted = await mintApiToken({ userId: fixture.manager.id, name: "MCP test", expiresInDays: 30 });
      const raw = minted.token;
      const target = agents.get(TARGET_AGENT);
      target.info.state = "thinking";
      const signal = new AbortController().signal;
      function request(method, params, token = raw, extra = {}) {
        return new Request("http://localhost/mcp", { method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json", "Accept": "application/json, text/event-stream", ...extra }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      }
      async function rpc(method, params, token = raw) {
        const response = await handleOfficeMcp(request(method, params, token));
        expect(response.status).toBe(200);
        return response.json();
      }
      async function call(name, args = {}, token = raw) {
        return (await rpc("tools/call", { name, arguments: args }, token)).result;
      }
      function text(result) { return result.content[0].text; }
      ${script}
      process.exit(0);
    `,
      ],
      { env: { ...process.env, BUREAU_HOME: home }, stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("HTTP MCP initializes, lists tools and scopes agent discovery", () => {
  isolated(`
    const init = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    expect(init.result.serverInfo.name).toBe("bureau");
    expect((await rpc("tools/list")).result.tools.map(t => t.name)).toEqual(["list_agents", "read_conversation", "send_message", "read_replies"]);
    const listed = JSON.parse(text(await call("list_agents"))).agents;
    expect(listed.some(a => a.id === TARGET_AGENT)).toBe(true);
    expect(listed.some(a => a.id === HIDDEN_AGENT)).toBe(false);
    const notified = new Request("http://localhost/mcp", { method: "POST", headers: { Authorization: "Bearer " + raw, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) });
    expect((await handleOfficeMcp(notified)).status).toBe(202);
  `);
});

test("MCP requires a live personal bearer and rejects foreign origins on all methods", () => {
  isolated(`
    for (const token of ["", "bad", fixture.privilegedToken]) expect((await handleOfficeMcp(request("tools/list", {}, token, { Cookie: "bureau_session=fake" }))).status).toBe(401);
    const expired = await mintApiToken({ userId: fixture.manager.id, name: "expired", expiresInDays: 30, now: Date.now() - 31 * 86400000 });
    expect((await handleOfficeMcp(request("tools/list", {}, expired.token))).status).toBe(401);
    for (const method of ["GET", "POST", "DELETE"]) {
      const req = new Request("http://localhost/mcp", { method, headers: { Authorization: "Bearer " + raw, Origin: "https://untrusted.example" } });
      expect((await handleOfficeMcp(req)).status).toBe(403);
    }
    expect((await handleOfficeMcp(new Request("http://localhost/mcp", { headers: { Authorization: "Bearer " + raw } }))).status).toBe(405);
    await revokeApiToken(fixture.manager.id, minted.apiToken.id);
    expect((await handleOfficeMcp(request("tools/list"))).status).toBe(401);
  `);
});

test("conversation reads enforce room access and bounded session selection", () => {
  isolated(`
    target.sessionId = "mcp-session";
    appendLog(TARGET_AGENT, "mcp-session", { id: "one", kind: "text", text: "Visible answer", timestamp: Date.now() });
    const result = JSON.parse(text(await call("read_conversation", { agentId: TARGET_AGENT, limit: 1 })));
    expect(result.entries[0].text).toBe("Visible answer");
    expect(text(await call("read_conversation", { agentId: HIDDEN_AGENT }))).toBe("forbidden");
    expect((await call("read_conversation", { agentId: TARGET_AGENT, sessionId: "../../secret" })).isError).toBe(true);
    expect((await call("read_conversation", { agentId: TARGET_AGENT, limit: 201 })).isError).toBe(true);
    updateUserById(fixture.manager.id, { allowedRooms: [] });
    expect(text(await call("read_conversation", { agentId: TARGET_AGENT }))).toBe("forbidden");
  `);
});

test("messages retain token identity and refuse commands and member prompts", () => {
  isolated(`
    for (const textValue of ["/approve", "  /resume", "\\n/model"]) expect(text(await call("send_message", { agentId: TARGET_AGENT, text: textValue }))).toBe("command_not_allowed");
    for (const prompt of ["permission", "resume", "model", "effort", "cronjob"]) {
      target.info.pendingPrompt = prompt;
      expect(text(await call("send_message", { agentId: TARGET_AGENT, text: "yes" }))).toBe("awaits_member_answer");
    }
    target.info.pendingPrompt = null;
    expect(text(await call("send_message", { agentId: HIDDEN_AGENT, text: "hello" }))).toBe("forbidden");
    expect(target.messageQueue).toHaveLength(0);
    const accepted = JSON.parse(text(await call("send_message", { agentId: TARGET_AGENT, text: "hello" })));
    expect(accepted.messageId).toBeString();
    expect(target.messageQueue[0].sender.device).toContain(minted.apiToken.id);
    const entries = JSON.parse(text(await call("read_replies"))).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].direction).toBe("to_agent");
    expect(entries[0].text).toBe("hello");
  `);
});

test("delivery rechecks access and prompts after awaiting the token mutex", () => {
  isolated(`
    const send = () => callOfficeTool("send_message", { agentId: TARGET_AGENT, text: "yes" }, raw, signal);
    const promptRace = send();
    target.info.pendingPrompt = "permission";
    await expect(promptRace).rejects.toThrow("awaits_member_answer");
    target.info.pendingPrompt = null;
    const roomRace = send();
    updateUserById(fixture.manager.id, { allowedRooms: [] });
    await expect(roomRace).rejects.toThrow("forbidden");
    updateUserById(fixture.manager.id, { allowedRooms: [fixture.visibleRoomId] });
    const memberRace = send();
    deleteUserById(fixture.manager.id);
    await expect(memberRace).rejects.toThrow("unauthenticated");
    expect(target.messageQueue).toHaveLength(0);
  `);
});

test("reply cursors isolate tokens and long polling observes arrivals, revocation and abort", () => {
  isolated(`
    const other = await mintApiToken({ userId: fixture.manager.id, name: "other", expiresInDays: 30 });
    const pending = callOfficeTool("read_replies", { waitSeconds: 1 }, raw, signal);
    await enqueueApiTokenInboxMessage({ tokenId: minted.apiToken.id, userId: fixture.manager.id, text: "answer", senderAgentId: TARGET_AGENT, senderAgentName: "Agent", senderRoomName: "Room" });
    const first = await pending;
    expect(first.entries[0].text).toBe("answer");
    expect((await callOfficeTool("read_replies", {}, other.token, signal)).entries).toHaveLength(0);
    expect((await callOfficeTool("read_replies", { after: first.entries[0].sequence }, raw, signal)).entries).toHaveLength(0);
    const controller = new AbortController();
    const aborted = callOfficeTool("read_replies", { after: first.latestSequence, waitSeconds: 25 }, raw, controller.signal);
    controller.abort();
    await expect(aborted).rejects.toThrow();
    const revoked = callOfficeTool("read_replies", { after: first.latestSequence, waitSeconds: 25 }, raw, signal);
    await revokeApiToken(fixture.manager.id, minted.apiToken.id);
    await expect(revoked).rejects.toThrow("unauthenticated");
    expect((await call("read_replies", { after: -1 }, other.token)).isError).toBe(true);
    expect((await call("read_replies", { waitSeconds: 26 }, other.token)).isError).toBe(true);
    expect((await call("read_replies", { tokenId: minted.apiToken.id }, other.token)).isError).toBe(true);
  `);
});

test("a Streamable HTTP SDK client completes initialization and tool calls", () => {
  isolated(`
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
    const listener = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handleOfficeMcp });
    const client = new Client({ name: "office-test", version: "1" });
    try {
      const transport = new StreamableHTTPClientTransport(new URL("/mcp", listener.url), { requestInit: { headers: { Authorization: "Bearer " + raw } } });
      await client.connect(transport);
      expect((await client.listTools()).tools).toHaveLength(4);
      const result = await client.callTool({ name: "list_agents", arguments: {} });
      expect(JSON.parse(text(result)).agents.some(a => a.id === TARGET_AGENT)).toBe(true);
    } finally {
      await client.close();
      listener.stop(true);
    }
  `);
});

test("office routing applies external-access and app-host boundaries before MCP", () => {
  isolated(`
    const { createFetchHandler } = await import("./server/http/router.ts");
    const { freezeBootState, setHasOwnerProvider, setPublicOriginFallback } = await import("./server/auth/http-env.ts");
    const { freezeAppHostDomain } = await import("./server/apps/domain.ts");
    setHasOwnerProvider(() => true);
    freezeBootState({ externalAccess: false });
    freezeAppHostDomain();
    const fetch = createFetchHandler();
    const local = { timeout: (_req, seconds) => expect(seconds).toBe(30), requestIP: () => ({ address: "127.0.0.1" }) };
    const remote = { timeout: (_req, seconds) => expect(seconds).toBe(30), requestIP: () => ({ address: "192.0.2.10" }) };
    expect((await fetch(request("tools/list"), local)).status).toBe(200);
    expect((await fetch(request("tools/list", {}, ""), local)).status).toBe(401);
    expect((await fetch(request("tools/list"), remote)).status).toBe(403);
    setPublicOriginFallback("https://office.example");
    freezeBootState({ externalAccess: true });
    freezeAppHostDomain();
    expect((await fetch(request("tools/list"), remote)).status).toBe(200);
    const appRequest = new Request("https://missing.office.example/mcp", { method: "POST", headers: { Host: "missing.office.example", Authorization: "Bearer " + raw } });
    expect((await fetch(appRequest, remote)).status).toBe(404);
  `);
});
