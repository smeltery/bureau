import { bureauSystemNotice } from "../session-types.ts";
import { logMessage } from "../../../shared/i18n/log-message.ts";
import type { NormalizedEvent } from "../types.ts";
import { providerFailure, providerFailureMessage } from "./connection/failures.ts";
import type { OpenCodeTurnAccounting } from "./connection/turn-accounting.ts";
import type { AllowedEvent, SafeOpenCodeError } from "./parse.ts";

export interface TrackedTool {
  callId: string;
  name: string;
  input: Record<string, unknown>;
  callEmitted: boolean;
  terminal: boolean;
}

export type EventSink = (event: NormalizedEvent) => void;

export function classifyFailure(error: SafeOpenCodeError): string {
  return providerFailure(error);
}

export function toolUpdateEvents(
  tool: TrackedTool,
  update: {
    status: "pending" | "running" | "completed" | "error";
    input: Record<string, unknown>;
    output?: string;
    error?: string;
    exitCode?: number;
    durationMs?: number;
  },
): NormalizedEvent[] {
  tool.input = update.input;
  const events: NormalizedEvent[] = [];
  const terminal = update.status === "completed" || update.status === "error";
  if (!tool.callEmitted && (Object.keys(update.input).length > 0 || terminal)) {
    tool.callEmitted = true;
    events.push({ kind: "tool_call", toolUseId: tool.callId, name: tool.name, input: tool.input });
  }
  if (!tool.terminal && terminal) {
    tool.terminal = true;
    events.push({
      kind: "tool_result",
      toolUseId: tool.callId,
      content: update.output ?? update.error ?? "",
      ...(update.durationMs !== undefined ? { durationMs: update.durationMs } : {}),
      ...(update.status === "error" || (update.exitCode !== undefined && update.exitCode !== 0) ? { isError: true } : {}),
    });
  }
  return events;
}

export function interruptedToolResults(tools: Iterable<TrackedTool>): NormalizedEvent[] {
  const results: NormalizedEvent[] = [];
  for (const tool of tools) {
    if (tool.terminal) continue;
    if (!tool.callEmitted) {
      tool.callEmitted = true;
      results.push({ kind: "tool_call", toolUseId: tool.callId, name: tool.name, input: tool.input });
    }
    results.push({ kind: "tool_result", toolUseId: tool.callId, content: "Tool interrupted.", isError: true });
  }
  return results;
}

export function applyOpenCodeEvent(
  event: AllowedEvent,
  ctx: {
    sink: EventSink;
    settle: (e: NormalizedEvent) => void;
    abortRequested: boolean;
    autoApprove: boolean;
    replyPermission: (id: string, reply: "once" | "reject") => Promise<void>;
    setPendingPermission: (pending: { id: string; sessionId: string } | null) => void;
    assistantMessages: Set<string>;
    textByPart: Map<string, string>;
    reasoningByPart: Map<string, string>;
    tools: Map<string, TrackedTool>;
    seenPermissions: Set<string>;
    accounting: OpenCodeTurnAccounting;
    onContext: (breakdown: NonNullable<Extract<AllowedEvent, { kind: "step_finish" }>["contextBreakdown"]>) => void;
  },
): void {
  if (event.kind === "assistant") {
    if (event.summary) {
      ctx.accounting.summaries.add(event.messageId);
      ctx.assistantMessages.delete(event.messageId);
    } else ctx.assistantMessages.add(event.messageId);
  }
  if (event.kind === "retry") ctx.sink(bureauSystemNotice(logMessage("logs.backend.retry", { error: providerFailureMessage({ message: event.message }), attempt: event.attempt })));
  if (event.kind === "text" && ctx.assistantMessages.has(event.messageId)) {
    const prior = ctx.textByPart.get(event.partId) ?? "";
    if (event.text.startsWith(prior)) {
      const delta = event.text.slice(prior.length);
      if (delta) ctx.sink({ kind: "assistant_text", text: delta });
    }
    ctx.textByPart.set(event.partId, event.text);
  }
  if (event.kind === "reasoning" && ctx.assistantMessages.has(event.messageId)) {
    const prior = ctx.reasoningByPart.get(event.partId) ?? "";
    if (event.text.startsWith(prior)) {
      const delta = event.text.slice(prior.length);
      if (delta) ctx.sink({ kind: "thinking", text: delta, ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}) });
      else if (event.durationMs !== undefined) ctx.sink({ kind: "thinking", text: "", durationMs: event.durationMs });
    }
    ctx.reasoningByPart.set(event.partId, event.text);
  }
  if (event.kind === "tool") {
    if (!ctx.tools.has(event.partId)) {
      ctx.tools.set(event.partId, { callId: event.callId, name: event.name, input: event.input, callEmitted: false, terminal: false });
    }
    for (const normalized of toolUpdateEvents(ctx.tools.get(event.partId)!, event)) ctx.sink(normalized);
  }
  if (event.kind === "permission") {
    if (ctx.seenPermissions.has(event.id)) return;
    ctx.seenPermissions.add(event.id);
    if (ctx.autoApprove) {
      void ctx.replyPermission(event.id, "once");
      return;
    }
    const permissionName = typeof event.permission === "string" ? event.permission : "unknown tool";
    const displayPatterns = Array.isArray(event.patterns) ? event.patterns.filter((v): v is string => typeof v === "string") : [];
    ctx.setPendingPermission({ id: event.id, sessionId: event.sessionId });
    ctx.sink({
      kind: "approval_request",
      approvalId: event.id,
      toolName: permissionName,
      input: displayPatterns.length ? { patterns: displayPatterns } : {},
      title: `OpenCode wants to use ${permissionName}`,
    });
  }
  if (event.kind === "permission_fault") {
    const msg = "OpenCode asked to use a tool but sent no permission id.";
    ctx.sink(bureauSystemNotice(logMessage("logs.backend.permissionFault")));
    ctx.settle({ kind: "turn_completed", status: "failed", error: msg });
  }
  if (event.kind === "step_finish") {
    if (ctx.accounting.record(event) && event.contextBreakdown) ctx.onContext(event.contextBreakdown);
  }
  if (event.kind === "idle") {
    if (ctx.abortRequested) {
      for (const result of interruptedToolResults(ctx.tools.values())) ctx.sink(result);
      ctx.settle({ kind: "turn_completed", status: "interrupted" });
    } else if (ctx.accounting.overflowPending) {
      ctx.settle({ kind: "turn_completed", status: "failed", error: providerFailure({ name: "ContextOverflowError" }) });
    } else if (ctx.accounting.completed) {
      ctx.settle({ kind: "turn_completed", status: "completed" });
    } else {
      ctx.settle({ kind: "turn_completed", status: "failed", error: "OpenCode became idle without a recorded completion." });
    }
  }
  if (event.kind === "error") {
    if (ctx.abortRequested) return;
    if (event.error.name === "ContextOverflowError") {
      ctx.accounting.overflowPending = true;
      ctx.sink(bureauSystemNotice(logMessage("logs.backend.compacting")));
      return;
    }
    ctx.settle({
      kind: "turn_completed",
      status: "failed",
      error: classifyFailure(event.error),
      ...(event.error.statusCode === 401 || event.error.statusCode === 403 ? { causedByAuth: true } : {}),
    });
  }
}
