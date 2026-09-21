import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { testAgentInfo } from "../../__tests__/agent-info-fixture.ts";
import { createManagedAgent } from "../../agents/managed-factory.ts";
import { buildSystemPrompt } from "../../agents/session/system-prompt.ts";
import { agents, officeConfig, setOfficeConfig } from "../../agents/state.ts";
import { _testResetAgentTokens, mintAgentToken } from "../../agents/tokens.ts";
import { handleAgentBearerPost } from "../../http/agent-bearer-routes.ts";
import { BrowserPool, launchOptions, parseBrowserParams } from "../session.ts";

describe("parseBrowserParams", () => {
  test("requires a known action", () => {
    expect(parseBrowserParams({ action: "dance" })).toMatchObject({
      ok: false,
      status: 400,
      code: "invalid_request",
    });
  });

  test("requires url for goto", () => {
    expect(parseBrowserParams({ action: "goto" })).toMatchObject({
      ok: false,
      error: "url is required for the goto action",
    });
  });

  test("rejects credentialed URLs", () => {
    expect(parseBrowserParams({ action: "goto", url: "http://user:pass@127.0.0.1/" })).toMatchObject({
      ok: false,
      error: "URLs with embedded credentials are not allowed",
    });
  });

  test("accepts bounded frame paths only for element actions with selectors", () => {
    expect(parseBrowserParams({ action: "click", selector: "button", framePath: [0, 1] })).toMatchObject({ ok: true, framePath: [0, 1] });
    expect(parseBrowserParams({ action: "fill", selector: "input", text: "hello", framePath: [] })).toMatchObject({ ok: true, framePath: [] });
    expect(parseBrowserParams({ action: "press", selector: "input", key: "Enter", framePath: [0] })).toMatchObject({ ok: true, framePath: [0] });

    for (const framePath of [null, "iframe", [-1], [0.5], [Infinity], [Number.MAX_SAFE_INTEGER + 1], Array(9).fill(0), ["0"]]) {
      expect(parseBrowserParams({ action: "click", selector: "button", framePath })).toMatchObject({ ok: false, code: "invalid_request" });
    }
    for (const action of ["snapshot", "goto", "close", "screenshot", "press"]) {
      expect(parseBrowserParams({ action, framePath: [] })).toMatchObject({ ok: false, code: "invalid_request" });
    }
  });
});

describe("launchOptions", () => {
  test("never passes --no-sandbox", () => {
    expect(launchOptions("/usr/bin/chromium").args).not.toContain("--no-sandbox");
  });
});

describe("BrowserPool URL policy", () => {
  test("rejects public IPs before launch", async () => {
    const pool = new BrowserPool({ findBrowser: () => "/bin/false", publicHostAllowlist: [] });
    const result = await pool.run("agent-1", { action: "goto", url: "http://8.8.8.8/" });
    expect(result).toMatchObject({
      ok: false,
      status: 400,
      error: "only local/private network URLs or preview-allowlisted hosts are supported",
    });
  });

  test("accepts allowlisted hosts then reports missing browser", async () => {
    const pool = new BrowserPool({
      findBrowser: () => null,
      publicHostAllowlist: ["staging.example.com"],
      lookupFn: async () => [{ address: "8.8.8.8", family: 4 }],
    });
    const result = await pool.run("agent-1", { action: "goto", url: "https://staging.example.com/" });
    expect(result).toMatchObject({ ok: false, status: 500, code: "no_browser" });
  });
});

describe("POST /api/agents/:id/browser", () => {
  const agentId = "browser-test-agent";
  let previous = officeConfig;
  let token = "";

  beforeEach(() => {
    previous = officeConfig;
    _testResetAgentTokens();
    agents.clear();
    agents.set(
      agentId,
      createManagedAgent({
        info: testAgentInfo({ id: agentId, name: "BrowserTester" }),
        skillCwd: process.cwd(),
        slashCommands: [],
        skills: [],
      }),
    );
    token = mintAgentToken(agentId, null);
    setOfficeConfig({ ...officeConfig, experimental: { browserPanel: false } });
  });

  afterEach(() => {
    setOfficeConfig(previous);
    _testResetAgentTokens();
    agents.clear();
  });

  test("returns 404 when experimental.browserPanel is off", async () => {
    const res = await handleAgentBearerPost(
      new Request(`http://local.test/api/agents/${agentId}/browser`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "goto", url: "http://127.0.0.1:3000/" }),
      }),
      ["agents", agentId, "browser"],
    );
    expect(res?.status).toBe(404);
    expect(await res!.json()).toMatchObject({ error: expect.stringContaining("disabled") });
  });

  test("returns 403 when token does not match agent", async () => {
    setOfficeConfig({ ...officeConfig, experimental: { browserPanel: true } });
    const other = mintAgentToken("other-agent", null);
    const res = await handleAgentBearerPost(
      new Request(`http://local.test/api/agents/${agentId}/browser`, {
        method: "POST",
        headers: { Authorization: `Bearer ${other}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close" }),
      }),
      ["agents", agentId, "browser"],
    );
    expect(res?.status).toBe(403);
  });

  test("returns 401 without bearer", async () => {
    setOfficeConfig({ ...officeConfig, experimental: { browserPanel: true } });
    const res = await handleAgentBearerPost(
      new Request(`http://local.test/api/agents/${agentId}/browser`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close" }),
      }),
      ["agents", agentId, "browser"],
    );
    expect(res?.status).toBe(401);
  });

  test("rejects public URLs when flag is on", async () => {
    setOfficeConfig({ ...officeConfig, experimental: { browserPanel: true }, previewAllowHosts: [] });
    const res = await handleAgentBearerPost(
      new Request(`http://local.test/api/agents/${agentId}/browser`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "goto", url: "http://8.8.8.8/" }),
      }),
      ["agents", agentId, "browser"],
    );
    expect(res?.status).toBe(400);
    expect(await res!.json()).toMatchObject({ error: expect.stringContaining("local/private") });
  });
});

describe("system prompt browser gate", () => {
  test("documents the API only when experimental.browserPanel is on", () => {
    const previous = officeConfig;
    setOfficeConfig({ ...officeConfig, experimental: { browserPanel: false } });
    expect(buildSystemPrompt("A", "agent-1", "Room")).not.toContain("/api/agents/agent-1/browser");
    setOfficeConfig({ ...officeConfig, experimental: { browserPanel: true } });
    expect(buildSystemPrompt("A", "agent-1", "Room")).toContain("/api/agents/agent-1/browser");
    setOfficeConfig(previous);
  });
});
