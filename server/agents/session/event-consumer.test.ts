import { afterEach, describe, expect, test } from "bun:test";

import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";
import type { BackendSession, NormalizedEvent } from "../../backends/types.ts";
import { createManagedAgent } from "../managed-factory.ts";
import { agents, logCache } from "../state.ts";
import { runConsumer, showNextPermissionPrompt } from "./event-consumer.ts";

afterEach(() => {
  agents.clear();
  logCache.clear();
});

function agentInfo(id: string, agentType: AgentInfo["agentType"] = "claude"): AgentInfo {
  return {
    id,
    name: "Event Consumer Test",
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
    agentType,
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "waiting_for_response",
    topic: null,
    topicStale: false,
    customInstructions: null,
  };
}

function eventSession(events: NormalizedEvent[]): BackendSession {
  return {
    async *stream() {
      yield* events;
    },
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

describe("runConsumer", () => {
  test("collapses relayed provider auth text into login instructions", async () => {
    const agentId = `event-consumer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const rawAuthText = "Codex failed with 401 authentication required.";
    const session = eventSession([{ kind: "system_text", text: rawAuthText }]);
    const managed = createManagedAgent({ info: agentInfo(agentId, "codex"), skillCwd: process.cwd(), slashCommands: [], skills: [] });
    managed.session = session;
    agents.set(agentId, managed);

    await runConsumer(agentId, managed, session);

    const entries = logCache.get(agentId) ?? [];
    expect(entries.some((entry) => entry.content === rawAuthText)).toBe(false);
    expect(entries.some((entry) => /sign in|login|log in/i.test(entry.content))).toBe(true);
  });

  test("keeps Bureau-authored auth-shaped system text verbatim", async () => {
    const agentId = `event-consumer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const text = "Allowing any command starting with `grep 401` for this session.";
    const session = eventSession([{ kind: "system_text", text, bureauAuthored: true }]);
    const managed = createManagedAgent({ info: agentInfo(agentId, "codex"), skillCwd: process.cwd(), slashCommands: [], skills: [] });
    managed.session = session;
    agents.set(agentId, managed);

    await runConsumer(agentId, managed, session);

    expect(logCache.get(agentId)?.map((entry) => entry.content)).toEqual([text]);
  });

  test("keeps ordinary provider system text verbatim", async () => {
    const agentId = `event-consumer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const text = "Provider session initialized.";
    const session = eventSession([{ kind: "system_text", text }]);
    const managed = createManagedAgent({ info: agentInfo(agentId, "codex"), skillCwd: process.cwd(), slashCommands: [], skills: [] });
    managed.session = session;
    agents.set(agentId, managed);

    await runConsumer(agentId, managed, session);

    expect(logCache.get(agentId)?.map((entry) => entry.content)).toEqual([text]);
  });

  test("shows Claude login card for typed account access denials", async () => {
    const agentId = `event-consumer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const rawDeniedText = "Your organization has disabled Claude subscription access.";
    const session = eventSession([{ kind: "system_text", text: rawDeniedText, claudeAccessDenied: true }]);
    const managed = createManagedAgent({ info: agentInfo(agentId, "claude"), skillCwd: process.cwd(), slashCommands: [], skills: [] });
    managed.session = session;
    agents.set(agentId, managed);

    await runConsumer(agentId, managed, session);

    const entries = logCache.get(agentId) ?? [];
    expect(entries.some((entry) => entry.content === rawDeniedText)).toBe(false);
    const system = entries.find((entry) => entry.kind === "system");
    expect(system?.content).toContain("Claude Code access is not available");
    expect(system?.metadata?.providerLogin).toBe("claude");
    expect(system?.metadata?.openConnections).toBe(true);
  });

  test("does not let late activity restore a busy state after a turn ends", async () => {
    const agentId = `event-consumer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const session = eventSession([
      { kind: "turn_completed", status: "completed" },
      { kind: "tool_call", toolUseId: "late-1", name: "Bash", input: { command: "date" } },
      { kind: "assistant_text", text: "late text" },
    ]);
    const managed = createManagedAgent({ info: agentInfo(agentId), skillCwd: process.cwd(), slashCommands: [], skills: [] });
    managed.session = session;
    managed.turnStartedAt = 123;
    managed.info = { ...managed.info, state: "thinking" };
    agents.set(agentId, managed);

    await runConsumer(agentId, managed, session);

    expect(managed.turnStartedAt).toBe(0);
    expect(managed.info.state).toBe("waiting_for_response");
    expect(logCache.get(agentId)?.map((entry) => entry.kind)).toEqual(["tool_call", "text"]);
  });

  test("queues concurrent approval prompts and opens them FIFO", async () => {
    const agentId = `event-consumer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const session = eventSession([
      { kind: "approval_request", approvalId: "approval-1", toolName: "Bash", input: { command: "date" } },
      { kind: "approval_request", approvalId: "approval-2", toolName: "Bash", input: { command: "pwd" } },
    ]);
    const managed = createManagedAgent({ info: agentInfo(agentId), skillCwd: process.cwd(), slashCommands: [], skills: [] });
    managed.session = session;
    agents.set(agentId, managed);

    await runConsumer(agentId, managed, session);

    expect(managed.pendingPermission?.approvalId).toBe("approval-1");
    expect(managed.queuedPermissions.map((queued) => queued.event.approvalId)).toEqual(["approval-2"]);

    managed.pendingPermission = null;
    showNextPermissionPrompt(agentId, managed);

    expect((managed.pendingPermission as { approvalId: string } | null)?.approvalId).toBe("approval-2");
    expect(managed.queuedPermissions).toEqual([]);
  });
});
