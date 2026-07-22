import { afterEach, describe, expect, test } from "bun:test";

import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../shared/types.ts";
import { createManagedAgent } from "./agents/managed-factory.ts";
import { agents, logCache } from "./agents/state.ts";
import { _testResetScheduledMessages, scheduleAgentMessage, tickScheduledMessages } from "./scheduled-messages.ts";

afterEach(() => {
  agents.clear();
  logCache.clear();
  _testResetScheduledMessages();
});

function installAgent(id: string, name: string) {
  const info: AgentInfo = {
    id,
    name,
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
  };
  agents.set(id, createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] }));
}

describe("scheduled messages", () => {
  test("notifies the sender when a due scheduled message is dropped", () => {
    const now = Date.now();
    installAgent("sender-1", "Sender");
    installAgent("receiver-1", "Receiver");

    const result = scheduleAgentMessage({
      senderAgentId: "sender-1",
      receiverAgentId: "receiver-1",
      text: "wake up",
      deliverAt: now + 1_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    agents.delete("receiver-1");
    tickScheduledMessages(now + 1_000);

    expect(logCache.get("sender-1")?.map((entry) => ({ kind: entry.kind, content: entry.content, metadata: entry.metadata }))).toEqual([
      {
        kind: "system",
        content: `Scheduled message ${result.entry.id} for ${new Date(result.entry.deliverAt).toISOString()} could not be delivered: agent not found.`,
        metadata: {
          scheduledId: result.entry.id,
          receiverAgentId: "receiver-1",
          deliverAt: result.entry.deliverAt,
        },
      },
    ]);
  });
});
