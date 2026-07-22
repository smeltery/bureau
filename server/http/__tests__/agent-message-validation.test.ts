import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";
import type { BackendSession } from "../../backends/types.ts";
import { createManagedAgent } from "../../agents/managed-factory.ts";
import { _testResetAgentTokens, mintAgentToken } from "../../agents/tokens.ts";
import { agents } from "../../agents/state.ts";
import { handleAgentsRequest } from "../agents.ts";

afterEach(() => {
  _testResetAgentTokens();
  agents.clear();
});

function request(path: string, body: unknown, headers: HeadersInit = {}): Request {
  return new Request(`http://local.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function installBusyAgent(id: string, sent: string[]) {
  const info: AgentInfo = {
    id,
    name: "Message Test",
    desk: 0,
    room: 0,
    cwd: process.cwd(),
    outfit: { hat: "none", color: "#000000", hair: "#000000", hairStyle: "short", skin: "#000000", beard: "none", accessory: null },
    permissionMode: "default",
    modelFamily: "sonnet",
    agentType: "claude",
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "thinking",
    topic: null,
    topicStale: false,
    customInstructions: null,
  };
  const managed = createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] });
  managed.session = {
    async *stream() {},
    async getContextUsage() {
      return null;
    },
    async send(text: string) {
      sent.push(text);
      const pending = managed.pendingTurn;
      managed.pendingTurn = null;
      pending?.resolve();
    },
    async approve() {},
    async abort() {},
    canAbortInPlace() {
      return false;
    },
    close() {},
  } satisfies BackendSession;
  agents.set(id, managed);
  return managed;
}

function installIdleAgent(id: string) {
  const info: AgentInfo = {
    id,
    name: "Sender Test",
    desk: 1,
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
  };
  const managed = createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] });
  agents.set(id, managed);
  return managed;
}

async function settleAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("agent message validation", () => {
  test("rejects malformed client message ids", async () => {
    const req = request("/api/agents/agent-1/messages", { text: "hello", clientMessageId: 123 });

    const res = await handleAgentsRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(422);
    expect(await res?.json()).toEqual({ error: "clientMessageId must be a string" });
  });

  test("rejects non-string scheduled delivery times", async () => {
    const token = mintAgentToken("agent-1", "user-1");
    const req = request(
      "/api/agents/agent-1/messages",
      { text: "later", deliverAt: Date.now() + 60_000 },
      {
        Authorization: `Bearer ${token}`,
      },
    );

    const res = await handleAgentsRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(422);
    expect(await res?.json()).toEqual({ error: "deliverAt must be a string" });
  });

  test("rejects malformed send-now flags", async () => {
    const req = request("/api/agents/agent-1/messages", { text: "hello", sendNow: "yes" });

    const res = await handleAgentsRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(422);
    expect(await res?.json()).toEqual({ error: "sendNow must be a boolean" });
  });

  test("rejects send-now flags from bearer-token senders", async () => {
    const token = mintAgentToken("agent-1", "user-1");
    const req = request(
      "/api/agents/agent-2/messages",
      { text: "hello", sendNow: true },
      {
        Authorization: `Bearer ${token}`,
      },
    );

    const res = await handleAgentsRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(400);
    expect(await res?.json()).toEqual({ error: "sendNow is only supported for user senders" });
  });

  test("flushes queued user messages when send-now is true", async () => {
    const sent: string[] = [];
    const managed = installBusyAgent("agent-1", sent);
    const req = request("/api/agents/agent-1/messages", { text: "urgent", sendNow: true });

    const res = await handleAgentsRequest(req, new URL(req.url), { kind: "loopback" });
    await settleAsyncWork();

    expect(res?.status).toBe(200);
    expect(managed.messageQueue).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("urgent");
    expect(sent[0]).toContain("queued while you were processing");
  });

  test("dedupes repeated bearer messages with the same client message id", async () => {
    const sent: string[] = [];
    const receiver = installBusyAgent("receiver-1", sent);
    installIdleAgent("sender-1");
    const token = mintAgentToken("sender-1", "user-1");
    const headers = { Authorization: `Bearer ${token}` };
    const body = { text: "retry once", clientMessageId: "client-msg-1" };

    const first = await handleAgentsRequest(request("/api/agents/receiver-1/messages", body, headers), new URL("http://local.test/api/agents/receiver-1/messages"), { kind: "loopback" });
    const second = await handleAgentsRequest(request("/api/agents/receiver-1/messages", body, headers), new URL("http://local.test/api/agents/receiver-1/messages"), { kind: "loopback" });
    const firstBody = await first?.json();
    const secondBody = await second?.json();

    expect(first?.status).toBe(200);
    expect(second?.status).toBe(200);
    expect(firstBody.messageId).toBe(secondBody.messageId);
    expect(receiver.messageQueue.map((m) => m.text)).toEqual(["retry once"]);
  });
});
