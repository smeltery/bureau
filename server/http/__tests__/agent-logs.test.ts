import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "fs";
import { join } from "path";
import { createManagedAgent } from "../../agents/managed-factory.ts";
import { agents } from "../../agents/state.ts";
import { _testResetAgentTokens, mintAgentToken } from "../../agents/tokens.ts";
import type { BackendSession } from "../../backends/types.ts";
import { LOGS_DIR } from "../../persistence/paths.ts";
import { appendLog } from "../../persistence/logs/logs.ts";
import { persistSessionFork, persistSessionTopic } from "../../persistence/logs/sessions.ts";
import { handleAgentsRequest } from "../agents.ts";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";

beforeEach(() => {
  _testResetAgentTokens();
  agents.clear();
  rmSync(join(LOGS_DIR, "agent-log-http"), { recursive: true, force: true });
});

afterEach(() => {
  _testResetAgentTokens();
  agents.clear();
  rmSync(join(LOGS_DIR, "agent-log-http"), { recursive: true, force: true });
});

function installAgent(id: string) {
  const info: AgentInfo = {
    id,
    name: "Log Agent",
    desk: 0,
    room: 0,
    cwd: process.cwd(),
    outfit: { hat: "none", color: "#000000", hair: "#000000", hairStyle: "short", skin: "#000000", beard: "none", accessory: null },
    permissionMode: "default",
    modelFamily: "sonnet",
    agentType: "claude",
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "idle",
    topic: null,
    topicStale: false,
    customInstructions: null,
    effort: "high",
  };
  const managed = createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] });
  managed.session = {
    async *stream() {},
    async getContextUsage() {
      return null;
    },
    async send() {},
    async approve() {},
    async abort() {},
    canAbortInPlace() {
      return false;
    },
    close() {},
  } satisfies BackendSession;
  agents.set(id, managed);
}

function bearerRequest(path: string, token: string): Request {
  return new Request(`http://local.test${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe("GET /api/agents/:id/logs", () => {
  test("lists persisted log sessions for an agent", async () => {
    installAgent("agent-log-http");
    appendLog("agent-log-http", "session-one", {
      id: "entry-one",
      agentId: "agent-log-http",
      timestamp: 1000,
      kind: "user_message",
      content: "first request",
    });
    persistSessionTopic("agent-log-http", "session-one", "Launch plan", 1);
    const token = mintAgentToken("agent-log-http", null);
    const req = bearerRequest("/api/agents/agent-log-http/logs", token);

    const res = await handleAgentsRequest(req, new URL(req.url));
    const body = await res?.json();

    expect(res?.status).toBe(200);
    expect(body).toMatchObject({
      mode: "index",
      sessions: [{ sessionId: "session-one", topic: "Launch plan" }],
    });
  });

  test("searches decoded conversation log text", async () => {
    installAgent("agent-log-http");
    appendLog("agent-log-http", "session-one", {
      id: "entry-one",
      agentId: "agent-log-http",
      timestamp: 1000,
      kind: "text",
      content: 'The boss said "ship it" today',
    });
    persistSessionTopic("agent-log-http", "session-one", "Release", 1);
    const token = mintAgentToken("agent-log-http", null);
    const req = bearerRequest(`/api/agents/agent-log-http/logs?q=${encodeURIComponent('said "ship it')}`, token);

    const res = await handleAgentsRequest(req, new URL(req.url));
    const body = await res?.json();

    expect(res?.status).toBe(200);
    expect(body).toMatchObject({
      mode: "search",
      totalMatches: 1,
      results: [{ sessionId: "session-one", entryId: "entry-one", sessionTopic: "Release" }],
    });
    expect(body.results[0].snippet).toContain('said "ship it"');
  });

  test("retrieves a session with ancestor entries", async () => {
    installAgent("agent-log-http");
    appendLog("agent-log-http", "root-session", {
      id: "root-one",
      agentId: "agent-log-http",
      timestamp: 1000,
      kind: "user_message",
      content: "original prompt",
    });
    appendLog("agent-log-http", "root-session", {
      id: "fork-point",
      agentId: "agent-log-http",
      timestamp: 2000,
      kind: "user_message",
      content: "edited later",
    });
    appendLog("agent-log-http", "child-session", {
      id: "child-one",
      agentId: "agent-log-http",
      timestamp: 3000,
      kind: "text",
      content: "branched answer",
    });
    persistSessionTopic("agent-log-http", "root-session", "Root", 2);
    persistSessionFork("agent-log-http", "child-session", "root-session", "fork-point", "Branch", 1, process.cwd());
    const token = mintAgentToken("agent-log-http", null);
    const req = bearerRequest("/api/agents/agent-log-http/logs?session=child-session", token);

    const res = await handleAgentsRequest(req, new URL(req.url));
    const body = await res?.json();

    expect(res?.status).toBe(200);
    expect(body.mode).toBe("retrieve");
    expect(body.entries.map((entry: { id: string }) => entry.id)).toEqual(["root-one", "child-one"]);
  });

  test("retrieves a window around a log entry", async () => {
    installAgent("agent-log-http");
    for (let index = 1; index <= 5; index++) {
      appendLog("agent-log-http", "session-one", {
        id: `entry-${index}`,
        agentId: "agent-log-http",
        timestamp: index,
        kind: index % 2 === 0 ? "text" : "user_message",
        content: `message ${index}`,
      });
    }
    persistSessionTopic("agent-log-http", "session-one", "Window", 5);
    const token = mintAgentToken("agent-log-http", null);
    const req = bearerRequest("/api/agents/agent-log-http/logs?session=session-one&around=entry-3&window=1", token);

    const res = await handleAgentsRequest(req, new URL(req.url));
    const body = await res?.json();

    expect(res?.status).toBe(200);
    expect(body.entries.map((entry: { id: string }) => entry.id)).toEqual(["entry-2", "entry-3", "entry-4"]);
  });

  test("validates log query parameters", async () => {
    installAgent("agent-log-http");
    const token = mintAgentToken("agent-log-http", null);
    const req = bearerRequest("/api/agents/agent-log-http/logs?limit=0", token);

    const res = await handleAgentsRequest(req, new URL(req.url));

    expect(res?.status).toBe(422);
    expect(await res?.json()).toEqual({ error: "limit must be an integer between 1 and 200" });
  });

  test("requires log access for bearer tokens", async () => {
    installAgent("agent-log-http");
    const token = mintAgentToken("agent-other-log-http", null);
    const req = bearerRequest("/api/agents/agent-log-http/logs", token);

    const res = await handleAgentsRequest(req, new URL(req.url));

    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "forbidden" });
  });
});
