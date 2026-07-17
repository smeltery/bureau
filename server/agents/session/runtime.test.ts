import { afterEach, describe, expect, test } from "bun:test";

import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";
import type { BackendSession } from "../../backends/types.ts";
import { createManagedAgent } from "../managed-factory.ts";
import { agents, logCache, type ManagedAgent } from "../state.ts";
import { replaceSession } from "./runtime.ts";

afterEach(() => {
  agents.clear();
  logCache.clear();
});

function makeAgent(id: string, session: BackendSession): ManagedAgent {
  const info: AgentInfo = {
    id,
    name: "Runtime Test",
    desk: 0,
    room: 0,
    cwd: process.cwd(),
    outfit: {
      hat: "none",
      color: "#000000",
      hair: "#000000",
      hairStyle: "short",
      skin: "#000000",
      beard: "none",
      accessory: null,
    },
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
  managed.session = session;
  agents.set(id, managed);
  return managed;
}

function fakeSession(): BackendSession {
  return {
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
  };
}

describe("replaceSession", () => {
  test("installs the replacement when the old consumer does not drain", async () => {
    const oldSession = fakeSession();
    const newSession = fakeSession();
    const managed = makeAgent("agent-1", oldSession);
    managed.consumerPromise = new Promise(() => {});

    await replaceSession("agent-1", managed, newSession, 5);

    expect(managed.session).toBe(newSession);
    expect(managed.info.sessionSwapping).toBe(false);
  });
});
