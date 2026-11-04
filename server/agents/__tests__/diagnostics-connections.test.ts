import { describe, expect, spyOn, test } from "bun:test";
import { claudeBackend } from "../../backends/claude.ts";
import { logMessage } from "../../../shared/i18n/log-message.ts";
import { emitLoginInstructions } from "../session/diagnostics.ts";
import { logCache, type ManagedAgent } from "../state.ts";

describe("emitLoginInstructions Connections notice", () => {
  test("attaches openConnections metadata for Claude auth failures", async () => {
    const agentId = `agent-conn-${crypto.randomUUID()}`;
    logCache.set(agentId, []);
    const managed = {
      info: { id: agentId, agentType: "claude", userId: "user-1", cwd: process.cwd() },
    } as ManagedAgent;
    // The real probe asks the host's Claude CLI, which reports "signed in" on a
    // logged-in Mac. Pin the signed-out answer an auth failure produces.
    const signedOut = spyOn(claudeBackend, "getLoginInstructions").mockImplementation(async () => ({ text: "Claude needs sign-in.", message: logMessage("logs.login.claude") }));
    try {
      await emitLoginInstructions(agentId, managed);
    } finally {
      signedOut.mockRestore();
    }
    const entries = logCache.get(agentId) ?? [];
    const system = entries.find((e) => e.kind === "system");
    expect(system).toBeTruthy();
    expect(system?.ephemeral).toBe(true);
    expect(system?.metadata?.openConnections).toBe(true);
    expect(system?.metadata?.providerLogin).toBe("claude");
    expect(system?.content).toContain("Connections");
  });

  test("attaches openConnections metadata for Codex auth failures", async () => {
    const agentId = `agent-conn-codex-${crypto.randomUUID()}`;
    logCache.set(agentId, []);
    const managed = {
      info: { id: agentId, agentType: "codex", userId: "user-1", cwd: process.cwd() },
    } as ManagedAgent;
    await emitLoginInstructions(agentId, managed);
    const entries = logCache.get(agentId) ?? [];
    const system = entries.find((e) => e.kind === "system");
    expect(system?.metadata?.openConnections).toBe(true);
    expect(system?.metadata?.providerLogin).toBe("codex");
  });
});
