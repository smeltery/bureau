import { afterEach, describe, expect, test } from "bun:test";

import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../../shared/types.ts";
import type { BackendSession } from "../../../backends/types.ts";
import { createManagedAgent } from "../../managed-factory.ts";
import { agents, logCache, persistAll, type ManagedAgent } from "../../state.ts";
import { AGENT_STOP_NOTICE, abortByAgent } from "../control.ts";
import { flushQueue } from "../message-queue.ts";
import { _testResetAgentTokens, mintAgentToken } from "../../tokens.ts";
import { handleAgentsRequest } from "../../../http/agents.ts";

afterEach(() => {
  _testResetAgentTokens();
  agents.clear();
  logCache.clear();
  persistAll();
});

function makeAgent(id: string, send: (text: string) => void = () => {}): ManagedAgent {
  const info: AgentInfo = {
    id,
    name: "Stop Test",
    desk: 0,
    room: 0,
    cwd: process.cwd(),
    outfit: { hat: "none", color: "#000000", hair: "#000000", hairStyle: "short", skin: "#000000", beard: "none", accessory: null },
    permissionMode: "default",
    modelFamily: "sonnet",
    agentType: "claude",
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "waiting_for_response",
    topic: null,
    topicStale: false,
    customInstructions: null,
  };
  const managed = createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] });
  const session: BackendSession = {
    async *stream() {},
    async getContextUsage() {
      return null;
    },
    async send(text: string) {
      send(text);
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
  };
  managed.session = session;
  agents.set(id, managed);
  return managed;
}

describe("abortByAgent", () => {
  test("refuses an idle agent without spending a steer slot", async () => {
    const managed = makeAgent("idle-agent");

    expect(await abortByAgent("idle-agent")).toEqual({ ok: false, status: 409, error: "nothing to stop" });
    expect(managed.recentSteers).toEqual([]);
    expect(managed.pendingContextNotices).toEqual([]);
  });

  test("stops a busy agent, arms the stop note, and shares the steer window", async () => {
    const managed = makeAgent("busy-agent");

    for (let i = 0; i < 3; i++) {
      managed.info.state = "thinking";
      expect(await abortByAgent("busy-agent")).toEqual({ ok: true });
      expect(managed.info.state as string).toBe("waiting_for_response");
    }
    managed.info.state = "thinking";
    const limited = await abortByAgent("busy-agent");

    expect(limited.ok).toBe(false);
    expect(!limited.ok && limited.status).toBe(429);
    expect(managed.info.state).toBe("thinking");
    expect(managed.pendingContextNotices).toEqual([AGENT_STOP_NOTICE, AGENT_STOP_NOTICE, AGENT_STOP_NOTICE]);
  });

  test("the next turn carries the note once, and a note armed during that send survives it", async () => {
    let armDuringSend = true;
    const sent: string[] = [];
    const managed = makeAgent("noted-agent", (text) => {
      sent.push(text);
      if (armDuringSend) managed.pendingContextNotices.push(AGENT_STOP_NOTICE);
      armDuringSend = false;
    });
    managed.pendingContextNotices.push(AGENT_STOP_NOTICE);
    managed.messageQueue.push({ id: "m1", sender: { kind: "user", username: "Nil" }, text: "continue", queuedAt: Date.now() });

    await flushQueue("noted-agent");

    expect(sent[0]).toContain(`[${AGENT_STOP_NOTICE}]`);
    expect(managed.pendingContextNotices).toEqual([AGENT_STOP_NOTICE]);
  });

  test("the HTTP route takes any agent token but the target's own", async () => {
    const managed = makeAgent("target");
    const abortAs = async (sender: string) => {
      const req = new Request("http://local.test/api/agents/target/abort", { method: "POST", headers: { Authorization: `Bearer ${mintAgentToken(sender, "user-1")}` } });
      return (await handleAgentsRequest(req, new URL(req.url), { kind: "loopback" }))!.status;
    };

    expect(await abortAs("target")).toBe(400);
    expect(await abortAs("peer")).toBe(409);
    managed.info.state = "thinking";
    expect(await abortAs("peer")).toBe(204);
    expect(managed.pendingContextNotices).toEqual([AGENT_STOP_NOTICE]);
  });
});
