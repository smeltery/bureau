import { describe, expect, test } from "bun:test";
import { emitLoginInstructions } from "../session/diagnostics.ts";
import { logCache, type ManagedAgent } from "../state.ts";

describe("emitLoginInstructions Connections notice", () => {
  test("attaches openConnections metadata for Claude auth failures", async () => {
    const agentId = `agent-conn-${crypto.randomUUID()}`;
    logCache.set(agentId, []);
    const managed = {
      info: { id: agentId, agentType: "claude", userId: "user-1", cwd: process.cwd() },
    } as ManagedAgent;
    await emitLoginInstructions(agentId, managed);
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
