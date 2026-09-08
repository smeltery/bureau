import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo, type LogEntry } from "../../../shared/types.ts";
import { createManagedAgent } from "../managed-factory.ts";
import { agents, emitEphemeralLog, logCache, persistAll } from "../state.ts";
import { editMessage } from "../conversation/edit.ts";

// Ephemeral slash echoes (unknown / unsupported commands) never reach the
// backend transcript. Editing them must trim the failed echo and re-dispatch
// through sendMessage — not attempt an SDK fork.
//
// Do not mock.module("send.ts"): Bun's module mock is process-wide and leaks
// into later files (e.g. agent message validation). Assert through real
// sendMessage side effects instead.

afterEach(() => {
  agents.clear();
  logCache.clear();
  persistAll();
});

function install(id: string, opts?: { fork?: boolean; sessionId?: string | null }): ReturnType<typeof createManagedAgent> {
  const info: AgentInfo = {
    id,
    name: "Ephemeral Edit Test",
    desk: 0,
    room: 0,
    cwd: process.cwd(),
    outfit: { hat: "none", color: "#000", hair: "#000", hairStyle: "short", skin: "#000", beard: "none", accessory: null },
    permissionMode: "default",
    modelFamily: "sonnet",
    agentType: opts?.fork === false ? "codex" : "claude",
    capabilities: { ...DEFAULT_AGENT_CAPABILITIES, fork: opts?.fork !== false },
    state: "waiting_for_response",
    topic: null,
    topicStale: false,
    customInstructions: null,
  };
  const managed = createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [{ name: "help", description: "List available commands" }], skills: [] });
  if (opts && "sessionId" in opts) managed.sessionId = opts.sessionId ?? null;
  else managed.sessionId = "session-1";
  agents.set(id, managed);
  return managed;
}

function seedEphemeralSlash(agentId: string, slash: string): LogEntry {
  emitEphemeralLog(agentId, "user_message", slash);
  emitEphemeralLog(agentId, "system", `Unknown command \`${slash.slice(1)}\`. Type \`/help\` to see available commands.`);
  const cached = logCache.get(agentId)!;
  return cached[cached.length - 2]!; // the user_message echo
}

function errors(id: string): string[] {
  return (logCache.get(id) ?? []).filter((e) => e.kind === "error").map((e) => e.content);
}

function contents(id: string): string[] {
  return (logCache.get(id) ?? []).map((e) => e.content);
}

describe("editMessage ephemeral slash rewrite", () => {
  test("trims the failed echo and re-dispatches through sendMessage", async () => {
    install("agent-1");
    const echo = seedEphemeralSlash("agent-1", "/hepl");

    await editMessage("agent-1", echo.id, "/help");

    const text = contents("agent-1");
    expect(text.some((c) => c.includes("/hepl"))).toBe(false);
    expect(text.some((c) => c.includes("Unknown command"))).toBe(false);
    // Real /help landed via sendMessage.
    expect(text.some((c) => c.includes("**Tips:**") || c.includes("/help"))).toBe(true);
  });

  test("works without a sessionId (first-message slash typo)", async () => {
    install("agent-1", { sessionId: null });
    const echo = seedEphemeralSlash("agent-1", "/hepl");

    await editMessage("agent-1", echo.id, "/help");

    expect(errors("agent-1")).toEqual([]);
    expect(contents("agent-1").some((c) => c.includes("/hepl"))).toBe(false);
  });

  test("works on a non-forking backend (no SDK fork attempted)", async () => {
    install("agent-codex", { fork: false });
    const echo = seedEphemeralSlash("agent-codex", "/hepl");

    await editMessage("agent-codex", echo.id, "/help");

    expect(errors("agent-codex").some((e) => e.includes("does not support forking"))).toBe(false);
    expect(contents("agent-codex").some((c) => c.includes("/hepl"))).toBe(false);
  });

  test("refuses while a multi-step prompt is pending", async () => {
    const managed = install("agent-1");
    managed.pendingModelPick = true;
    const echo = seedEphemeralSlash("agent-1", "/hepl");

    await editMessage("agent-1", echo.id, "/help");

    expect(errors("agent-1")[0]).toContain("pending prompt");
    // Echo remains so the user can still see what they typed.
    expect(logCache.get("agent-1")!.some((e) => e.id === echo.id)).toBe(true);
  });

  test("refuses when a real (non-ephemeral) entry follows", async () => {
    install("agent-1");
    const echo = seedEphemeralSlash("agent-1", "/hepl");
    const real: LogEntry = {
      id: "real-1",
      agentId: "agent-1",
      timestamp: Date.now(),
      kind: "text",
      content: "later real output",
    };
    logCache.get("agent-1")!.push(real);

    await editMessage("agent-1", echo.id, "/help");

    expect(errors("agent-1")[0]).toContain("not sent");
  });

  test("refuses when a later user_message follows", async () => {
    install("agent-1");
    const echo = seedEphemeralSlash("agent-1", "/hepl");
    emitEphemeralLog("agent-1", "user_message", "/status");

    await editMessage("agent-1", echo.id, "/help");

    expect(errors("agent-1")[0]).toContain("not sent");
  });

  test("non-ephemeral edits still hit the fork capability gate", async () => {
    install("agent-codex", { fork: false });
    const durable: LogEntry = {
      id: "durable-1",
      agentId: "agent-codex",
      timestamp: Date.now(),
      kind: "user_message",
      content: "hello",
    };
    logCache.set("agent-codex", [durable]);

    await editMessage("agent-codex", durable.id, "hello again");

    expect(errors("agent-codex")[0]).toContain("does not support forking");
  });
});
