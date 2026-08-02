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
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo, type LogEntry } from "../../../shared/types.ts";

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

function appendEntry(sessionId: string, id: string, kind: LogEntry["kind"], content: string, timestamp = 1000) {
  appendLog("agent-log-http", sessionId, { id, agentId: "agent-log-http", timestamp, kind, content });
}

describe("GET /api/agents/:id/logs", () => {
  test("lists persisted log sessions for an agent", async () => {
    installAgent("agent-log-http");
    appendEntry("session-one", "entry-one", "user_message", "first request");
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
    appendEntry("session-one", "entry-one", "text", 'The boss said "ship it" today');
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
    appendEntry("root-session", "root-one", "user_message", "original prompt");
    appendEntry("root-session", "fork-point", "user_message", "edited later", 2000);
    appendEntry("child-session", "child-one", "text", "branched answer", 3000);
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
      appendEntry("session-one", `entry-${index}`, index % 2 === 0 ? "text" : "user_message", `message ${index}`, index);
    }
    persistSessionTopic("agent-log-http", "session-one", "Window", 5);
    const token = mintAgentToken("agent-log-http", null);
    const req = bearerRequest("/api/agents/agent-log-http/logs?session=session-one&around=entry-3&window=1", token);

    const res = await handleAgentsRequest(req, new URL(req.url));
    const body = await res?.json();

    expect(res?.status).toBe(200);
    expect(body.entries.map((entry: { id: string }) => entry.id)).toEqual(["entry-2", "entry-3", "entry-4"]);
  });

  test("filters retrieved logs by tier", async () => {
    installAgent("agent-log-http");
    appendEntry("session-one", "prompt-one", "user_message", "boss request", 1);
    appendEntry("session-one", "reply-one", "text", "agent reply", 2);
    persistSessionTopic("agent-log-http", "session-one", "Tier", 2);
    const token = mintAgentToken("agent-log-http", null);
    const req = bearerRequest("/api/agents/agent-log-http/logs?session=session-one&tier=prompts", token);

    const res = await handleAgentsRequest(req, new URL(req.url));
    const body = await res?.json();

    expect(res?.status).toBe(200);
    expect(body.entries.map((entry: { id: string }) => entry.id)).toEqual(["prompt-one"]);
  });

  test("searches full-tier and explicit log kinds", async () => {
    installAgent("agent-log-http");
    appendEntry("session-one", "tool-one", "tool_result", "rare-build-token", 1);
    appendEntry("session-one", "text-one", "text", "rare-build-token", 2);
    persistSessionTopic("agent-log-http", "session-one", "Kinds", 2);
    const token = mintAgentToken("agent-log-http", null);
    const fullReq = bearerRequest("/api/agents/agent-log-http/logs?q=rare-build-token&tier=full", token);
    const toolReq = bearerRequest("/api/agents/agent-log-http/logs?q=rare-build-token&kind=tool_result", token);

    const full = await handleAgentsRequest(fullReq, new URL(fullReq.url));
    const tool = await handleAgentsRequest(toolReq, new URL(toolReq.url));
    const fullBody = await full?.json();
    const toolBody = await tool?.json();

    expect(full?.status).toBe(200);
    expect(tool?.status).toBe(200);
    expect(fullBody.results.map((hit: { entryId: string }) => hit.entryId)).toEqual(["text-one", "tool-one"]);
    expect(toolBody.results.map((hit: { entryId: string }) => hit.entryId)).toEqual(["tool-one"]);
  });

  test("searches logs with a case-insensitive regular expression", async () => {
    installAgent("agent-log-http");
    appendEntry("session-one", "regex-one", "text", "Slide   mode shipped");
    persistSessionTopic("agent-log-http", "session-one", "Regex", 1);
    const token = mintAgentToken("agent-log-http", null);
    const req = bearerRequest(`/api/agents/agent-log-http/logs?q=${encodeURIComponent("sl.de\\s+MODE")}&regex=1`, token);

    const res = await handleAgentsRequest(req, new URL(req.url));
    const body = await res?.json();

    expect(res?.status).toBe(200);
    expect(body).toMatchObject({
      mode: "search",
      query: "sl.de\\s+MODE",
      totalMatches: 1,
      results: [{ entryId: "regex-one" }],
    });
    expect(body.results[0].snippet).toContain("Slide mode");
  });

  test("filters search and retrieval by timestamp bounds", async () => {
    installAgent("agent-log-http");
    for (const [id, timestamp] of [
      ["old", 1000],
      ["middle", 2000],
      ["new", 3000],
    ] as const) {
      appendEntry("session-one", id, "text", "bounded-token", timestamp);
    }
    persistSessionTopic("agent-log-http", "session-one", "Bounds", 3);
    const token = mintAgentToken("agent-log-http", null);
    const searchReq = bearerRequest("/api/agents/agent-log-http/logs?q=bounded-token&after=1500&before=2500", token);
    const retrieveReq = bearerRequest("/api/agents/agent-log-http/logs?session=session-one&after=1500&before=2500", token);

    const search = await handleAgentsRequest(searchReq, new URL(searchReq.url));
    const retrieve = await handleAgentsRequest(retrieveReq, new URL(retrieveReq.url));
    const searchBody = await search?.json();
    const retrieveBody = await retrieve?.json();

    expect(search?.status).toBe(200);
    expect(retrieve?.status).toBe(200);
    expect(searchBody.results.map((hit: { entryId: string }) => hit.entryId)).toEqual(["middle"]);
    expect(retrieveBody.entries.map((entry: { id: string }) => entry.id)).toEqual(["middle"]);
  });

  test("validates log query parameters", async () => {
    installAgent("agent-log-http");
    const token = mintAgentToken("agent-log-http", null);
    const req = bearerRequest("/api/agents/agent-log-http/logs?limit=0", token);

    const res = await handleAgentsRequest(req, new URL(req.url));

    expect(res?.status).toBe(422);
    expect(await res?.json()).toEqual({ error: "limit must be an integer between 1 and 200" });
  });

  test("validates regex searches", async () => {
    installAgent("agent-log-http");
    const token = mintAgentToken("agent-log-http", null);
    const invalidReq = bearerRequest("/api/agents/agent-log-http/logs?q=%5B&regex=1", token);
    const tooLongReq = bearerRequest(`/api/agents/agent-log-http/logs?q=${"a".repeat(201)}&regex=1`, token);

    const invalid = await handleAgentsRequest(invalidReq, new URL(invalidReq.url));
    const tooLong = await handleAgentsRequest(tooLongReq, new URL(tooLongReq.url));

    expect(invalid?.status).toBe(422);
    expect(await invalid?.json()).toEqual({ error: "q is not a valid regular expression" });
    expect(tooLong?.status).toBe(422);
    expect(await tooLong?.json()).toEqual({ error: "q must be at most 200 characters when regex=1" });
  });

  test("validates timestamp bounds", async () => {
    installAgent("agent-log-http");
    const token = mintAgentToken("agent-log-http", null);
    const req = bearerRequest("/api/agents/agent-log-http/logs?after=-1", token);

    const res = await handleAgentsRequest(req, new URL(req.url));

    expect(res?.status).toBe(422);
    expect(await res?.json()).toEqual({ error: "after must be a nonnegative integer timestamp" });
  });

  test("validates log kind filters", async () => {
    installAgent("agent-log-http");
    const token = mintAgentToken("agent-log-http", null);
    const tierReq = bearerRequest("/api/agents/agent-log-http/logs?tier=nope", token);
    const kindReq = bearerRequest("/api/agents/agent-log-http/logs?kind=nope", token);

    const tier = await handleAgentsRequest(tierReq, new URL(tierReq.url));
    const kind = await handleAgentsRequest(kindReq, new URL(kindReq.url));

    expect(tier?.status).toBe(422);
    expect(await tier?.json()).toEqual({ error: "tier must be one of: prompts, conversation, full" });
    expect(kind?.status).toBe(422);
    expect(await kind?.json()).toEqual({
      error: "kind must be a comma-separated subset of: text, thinking, tool_call, tool_result, error, system, user_message, diff, edit-request, terminal-command, file-view",
    });
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
