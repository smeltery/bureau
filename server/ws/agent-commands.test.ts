import { afterEach, describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../shared/types.ts";
import { createManagedAgent } from "../agents/managed-factory.ts";
import { agents } from "../agents/state.ts";
import { handleAgentCommand } from "./agent-commands.ts";

function wsSink(sent: string[]): ServerWebSocket<unknown> {
  return {
    send(message: string) {
      sent.push(message);
      return 0;
    },
  } as ServerWebSocket<unknown>;
}

function installAgent(id: string, name: string, desk = 0) {
  const info: AgentInfo = {
    id,
    name,
    userId: null,
    desk,
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
    queue: [],
  };
  agents.set(id, createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] }));
}

afterEach(() => {
  agents.clear();
});

describe("handleAgentCommand", () => {
  test("reports rejected websocket spawns instead of false success", async () => {
    installAgent("agent-1", "Taken");
    const sent: string[] = [];

    const handled = await handleAgentCommand(
      {
        type: "spawn",
        requestId: "req-1",
        name: "taken",
        cwd: process.cwd(),
        permissionMode: "default",
        agentType: "claude",
      } as never,
      wsSink(sent),
    );

    expect(handled).toBe(true);
    expect(agents.size).toBe(1);
    expect(JSON.parse(sent[0]!)).toEqual({
      type: "agent_save_response",
      requestId: "req-1",
      ok: false,
      error: "agent name is taken or desk is unavailable",
    });
  });

  // The WS twin of PUT /api/agents/:id/privileged. A socket with no bound
  // browser-session user — which is all an agent could ever present, since agent
  // bearer tokens never establish a WS identity — must not flip the flag.
  test("refuses set_agent_privileged from a socket with no signed-in user", async () => {
    installAgent("agent-1", "Operator");
    const sent: string[] = [];

    const handled = await handleAgentCommand({ type: "set_agent_privileged", requestId: "req-1", agentId: "agent-1", privileged: true } as never, wsSink(sent));

    expect(handled).toBe(true);
    expect(agents.get("agent-1")?.info.privileged ?? false).toBe(false);
    expect(sent).toEqual([]);
  });
});
