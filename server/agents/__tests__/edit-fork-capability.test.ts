import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";
import { createManagedAgent } from "../managed-factory.ts";
import { agents, logCache, persistAll } from "../state.ts";
import { editMessage } from "../conversation/edit.ts";

// Editing a past message forks the session through the Claude SDK's
// forkSession. A backend that declares `fork: false` (the Codex backend does)
// cannot honour that, so the refusal has to happen before the SDK is reached —
// otherwise the failure surfaces as an opaque complaint about a session id the
// SDK never issued.

afterEach(() => {
  agents.clear();
  logCache.clear();
  // These tests persistAll() into the real BUREAU_DIR; re-persist the cleared
  // map so a later test file that boots the server cannot restore them.
  persistAll();
});

function install(id: string, fork: boolean, state: AgentInfo["state"] = "waiting_for_response"): void {
  const info: AgentInfo = {
    id,
    name: "Fork Test",
    desk: 0,
    room: 0,
    cwd: process.cwd(),
    outfit: { hat: "none", color: "#000", hair: "#000", hairStyle: "short", skin: "#000", beard: "none", accessory: null },
    permissionMode: "default",
    modelFamily: "sonnet",
    agentType: fork ? "claude" : "codex",
    capabilities: { ...DEFAULT_AGENT_CAPABILITIES, fork },
    state,
    topic: null,
    topicStale: false,
    customInstructions: null,
  };
  const managed = createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] });
  managed.sessionId = "session-1";
  agents.set(id, managed);
}

function errors(id: string): string[] {
  return (logCache.get(id) ?? []).filter((e) => e.kind === "error").map((e) => e.content);
}

function seedDurableUser(id: string, entryId = "entry-1"): void {
  logCache.set(id, [
    {
      id: entryId,
      agentId: id,
      timestamp: Date.now(),
      kind: "user_message",
      content: "original text",
    },
  ]);
}

describe("editMessage fork capability", () => {
  test("a backend that cannot fork is refused, with a next step", async () => {
    install("agent-codex", false);
    seedDurableUser("agent-codex");

    await editMessage("agent-codex", "entry-1", "revised text");

    const said = errors("agent-codex");
    expect(said).toHaveLength(1);
    expect(said[0]).toContain("does not support forking");
    // Not a dead end: the operator is told what to do instead.
    expect(said[0]).toContain("Send a new message instead");
  });

  test("the refusal happens before the SDK, so nothing else is disturbed", async () => {
    install("agent-codex", false);
    seedDurableUser("agent-codex");
    const managed = agents.get("agent-codex")!;

    await editMessage("agent-codex", "entry-1", "revised text");

    // Same session, same state: no fork was attempted and no recovery ran.
    expect(managed.sessionId).toBe("session-1");
    expect(managed.info.state).toBe("waiting_for_response");
  });

  test("a forking backend is not refused by this check", async () => {
    install("agent-claude", true);
    seedDurableUser("agent-claude");

    await editMessage("agent-claude", "entry-1", "revised text");

    // It fails later (there is no real SDK session here), but never with the
    // capability refusal — which is what this test pins.
    expect(errors("agent-claude").some((e) => e.includes("does not support forking"))).toBe(false);
  });

  test("a stopped forking backend is allowed into the edit path", async () => {
    install("agent-stopped", true, "stopped");
    seedDurableUser("agent-stopped");

    await editMessage("agent-stopped", "entry-1", "revised text");

    expect(errors("agent-stopped").some((e) => e.includes("Cannot edit while agent is busy"))).toBe(false);
  });
});
