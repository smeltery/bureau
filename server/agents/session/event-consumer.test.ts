import { BureauLogError } from "../../../shared/i18n/backend-errors/error.ts";
import { bureauError, bureauTurnFailure } from "../../backends/session-types.ts";
import { codexSubprocessExitEvent } from "../../backends/codex/session-process-events.ts";
import { logMessage, displayLogContent } from "../../../shared/i18n/log-message.ts";
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

test("capacity and compaction notices translate while provider content stays literal", async () => {
  const agentId = `notice-${crypto.randomUUID()}`;
  const session = eventSession([
    { kind: "provider_capacity_retry", attempt: 1, maxAttempts: 5, delayMs: 1500 },
    { kind: "compacted", summary: "Provider summary {original}" },
    { kind: "compacted" },
    { kind: "permission_denied", toolUseId: "denied-1", toolName: "CustomTool", message: "" },
    { kind: "permission_denied", toolUseId: "denied-2", toolName: "CustomTool", message: "Provider reason" },
    { kind: "system_text", text: "Provider text" },
  ]);
  const managed = createManagedAgent({ info: agentInfo(agentId, "codex"), skillCwd: process.cwd(), slashCommands: [], skills: [] });
  managed.session = session;
  agents.set(agentId, managed);
  await runConsumer(agentId, managed, session);
  const entries = logCache.get(agentId)!;
  expect(entries[0].content).toBe("Provider is at capacity. Retrying in 1.5s (2/5).");
  expect(displayLogContent(entries[0], "es")).toContain("1,5s (2/5)");
  expect(displayLogContent(entries[1], "zh")).toBe("上下文已压缩：Provider summary {original}");
  expect(displayLogContent(entries[2], "ca")).toBe("Context compactat.");
  expect(displayLogContent(entries[3], "es")).toBe("CustomTool denegado.");
  expect(entries[3].metadata?.permissionDenied).toEqual(expect.objectContaining({ toolUseId: "denied-1" }));
  expect(displayLogContent(entries[4], "es")).toBe("Provider reason");
  expect(entries[4].message).toBeUndefined();
  expect(displayLogContent(entries[5], "zh")).toBe("Provider text");
});

test("approval prompts translate instructions and preserve provider titles and prefix syntax", async () => {
  const agentId = `approval-${crypto.randomUUID()}`;
  const session = eventSession([
    {
      kind: "approval_request",
      approvalId: "approve-original",
      toolName: "Bash",
      title: "Original title {literal}",
      description: "Original description",
      input: { command: "rg --files" },
      allowPrefixLabel: "rg --files",
      allowPrefixExample: "rg",
    },
  ]);
  const managed = createManagedAgent({ info: agentInfo(agentId, "codex"), skillCwd: process.cwd(), slashCommands: [], skills: [] });
  managed.session = session;
  agents.set(agentId, managed);
  await runConsumer(agentId, managed, session);
  const entry = logCache.get(agentId)!.at(-1)!;
  expect(entry.content).toContain("1. Allow — and don't ask again for similar calls this session");
  for (const language of ["es", "ca", "zh"] as const) {
    const text = displayLogContent(entry, language);
    for (const literal of ["Original title {literal}", "Original description", "rg --files", "4 <prefix>", "4 rg"]) expect(text).toContain(literal);
    expect(text).not.toBe(entry.content);
  }
  expect(managed.pendingPermission).toEqual({ approvalId: "approve-original", toolName: "Bash", allowPrefixLabel: "rg --files" });
});

test("event and stream failures render translated diagnoses while retaining metadata", async () => {
  for (const streamFailure of [false, true]) {
    const agentId = `failure-${crypto.randomUUID()}`;
    const raw = "process exited with code 143";
    const session = eventSession([{ kind: "error", message: raw }]);
    if (streamFailure)
      session.stream = async function* () {
        yield { kind: "system_text", text: "Before failure" };
        throw new Error(raw);
      };
    const managed = createManagedAgent({ info: agentInfo(agentId, "codex"), skillCwd: process.cwd(), slashCommands: [], skills: [] });
    managed.session = session;
    agents.set(agentId, managed);
    await runConsumer(agentId, managed, session);
    const entry = logCache.get(agentId)!.find((entry) => entry.kind === "error")!;
    expect(entry.metadata?.backendFailureRaw).toBe(raw);
    expect(displayLogContent(entry, "es")).toContain("SIGTERM (código 143)");
    expect(displayLogContent(entry, "es").startsWith("Error de flujo:")).toBe(streamFailure);
    expect(managed.info.state).toBe("error");
  }
});

test("auth and failure state use original errors while Bureau explanations translate", async () => {
  for (const event of [
    bureauTurnFailure(logMessage("logs.provider.rateLimit")),
    bureauError(logMessage("logs.backend.streamFailed", { error: "Original detail {value}" })),
    { ...bureauTurnFailure(logMessage("logs.provider.auth")), causedByAuth: true },
    {
      ...bureauTurnFailure(logMessage("logs.backendError.providerRefused", { model: "vendor/model", detail: "403 Forbidden: plan excludes this model; error_during_execution" })),
      causedByAuth: false,
    },
    codexSubprocessExitEvent({ code: 143, signal: null, turnInFlight: true }),
  ]) {
    const agentId = crypto.randomUUID();
    const session = eventSession([event]);
    const managed = createManagedAgent({ info: agentInfo(agentId, "opencode"), skillCwd: process.cwd(), slashCommands: [], skills: [] });
    managed.session = session;
    agents.set(agentId, managed);
    await runConsumer(agentId, managed, session);
    const entry = logCache.get(agentId)!.find((entry) => entry.kind === "error")!;
    for (const language of ["es", "ca", "zh"] as const) expect(displayLogContent(entry, language)).not.toBe(entry.content);
    expect(managed.info.state).toBe("causedByAuth" in event && event.causedByAuth ? "waiting_for_response" : "error");
    if (event.kind === "turn_completed" && event.causedByAuth === false) {
      expect(displayLogContent(entry, "es")).toContain("403 Forbidden: plan excludes this model; error_during_execution");
      expect(logCache.get(agentId)!.some((entry) => entry.kind === "terminal-command")).toBe(false);
    }
    if (event.kind === "error") expect(displayLogContent(entry, "zh")).toContain("Original detail {value}");
    if (event.kind === "turn_completed" && event.error?.includes("143")) {
      expect(entry.message?.key).toBe("logs.diagnostic.terminated");
      expect(entry.metadata?.backendFailureRaw).toBe(event.error);
    }
  }
});

test("provider errors cannot supply translation metadata without Bureau authorship", async () => {
  const agentId = crypto.randomUUID();
  const errorMessage = logMessage("logs.provider.auth");
  const session = eventSession([
    { kind: "turn_completed", status: "failed", error: "Original completion", errorMessage },
    { kind: "error", message: "Original failure", errorMessage },
  ]);
  const managed = createManagedAgent({ info: agentInfo(agentId, "opencode"), skillCwd: process.cwd(), slashCommands: [], skills: [] });
  managed.session = session;
  agents.set(agentId, managed);
  await runConsumer(agentId, managed, session);
  const entries = logCache.get(agentId)!;
  expect(entries.map((entry) => displayLogContent(entry, "zh"))).toEqual(["Original completion", "Original failure"]);
  expect(entries.every((entry) => entry.message === undefined)).toBe(true);
  expect(managed.info.state).toBe("error");
});

test("owned errors thrown by streams keep translation metadata and canonical failure state", async () => {
  const agentId = crypto.randomUUID();
  const session = eventSession([]);
  const message = logMessage("logs.backendError.timeout", { path: "/session/literal" });
  session.stream = async function* () {
    yield { kind: "system_text", text: "Literal provider output" };
    throw new BureauLogError(message);
  };
  const managed = createManagedAgent({ info: agentInfo(agentId, "opencode"), skillCwd: process.cwd(), slashCommands: [], skills: [] });
  managed.session = session;
  agents.set(agentId, managed);
  await runConsumer(agentId, managed, session);
  const entry = logCache.get(agentId)!.find((entry) => entry.kind === "error")!;
  expect(entry.content).toBe("Stream error: OpenCode request timed out at /session/literal.");
  expect(entry.message?.params?.error).toEqual(message);
  for (const language of ["es", "ca", "zh"] as const) {
    expect(displayLogContent(entry, language)).not.toContain("request timed out");
    expect(displayLogContent(entry, language)).toContain("/session/literal");
  }
  expect(managed.info.state).toBe("error");
});
