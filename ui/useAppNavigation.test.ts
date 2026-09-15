import { describe, expect, test } from "bun:test";
import type { AgentInfo } from "../shared/types.ts";
import { cycleAgent } from "./navigation-helpers.ts";

const agents = [agent("idle-a", 0, "idle"), agent("thinking-b", 1, "thinking"), agent("idle-c", 2, "idle"), agent("stopped-d", 3, "stopped"), { ...agent("other-room", 0, "thinking"), room: 1 }];

describe("cycleAgent", () => {
  test("prefers active or drafted agents in the current room", () => {
    const drafts = new Map([["idle-c", "pending text"]]);

    expect(cycleAgent(agents, drafts, 0, null, "next")).toBe("thinking-b");
    expect(cycleAgent(agents, drafts, 0, "thinking-b", "next")).toBe("idle-c");
    expect(cycleAgent(agents, drafts, 0, "thinking-b", "prev")).toBe("idle-c");
  });

  test("falls back to desk order when every agent is idle or stopped", () => {
    const idleAgents = [agent("a", 0, "idle"), agent("b", 1, "stopped")];

    expect(cycleAgent(idleAgents, new Map(), 0, null, "next")).toBe("a");
    expect(cycleAgent(idleAgents, new Map(), 0, "a", "next")).toBe("b");
    expect(cycleAgent(idleAgents, new Map(), 0, "a", "prev")).toBe("b");
  });

  test("returns null when there is no other candidate", () => {
    expect(cycleAgent([agent("solo", 0, "thinking")], new Map(), 0, "solo", "next")).toBeNull();
    expect(cycleAgent(agents, new Map(), 9, null, "next")).toBeNull();
  });
});

function agent(id: string, desk: number, state: AgentInfo["state"]): AgentInfo {
  return {
    id,
    name: id,
    cwd: "~",
    outfit: {} as AgentInfo["outfit"],
    state,
    desk,
    room: 0,
    roomId: "room-1",
    permissionMode: "default",
    capabilities: {} as AgentInfo["capabilities"],
    customInstructions: null,
    modelFamily: "opus",
    agentType: "claude",
    codexSandbox: "workspace-write",
    effort: "xhigh",
    topic: null,
    topicStale: false,
  };
}
