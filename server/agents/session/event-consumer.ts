import type { AgentState } from "../../../shared/types.ts";
import { accumulateSessionUsage, appendLog, appendSessionUsageSnapshot, ensureSessionClaudeConfigDir, ensureSessionCwd, loadLogWithAncestors } from "../../persistence.ts";
import type { BackendSession, NormalizedEvent } from "../../backends/types.ts";
import { ProviderCapacityError } from "../../internal-types.ts";
import { autocompleteCommands } from "../commands.ts";
import { deduplicateSkills, discoverBundledSkills, discoverPluginSkills, discoverProjectSkills, discoverUserSkills } from "../skills-discovery.ts";
import { addLogEntry, agents, clearLiveTurn, emit, emitEphemeralLog, logCache, persistAll, syncPendingPrompt, updateState, type ManagedAgent } from "../state.ts";
import { diagnoseProcessExit, emitLoginInstructions as emitLoginInstructionsImpl, emitLoginInstructionsIfAuth, isAuthErrorForAgent } from "./diagnostics.ts";
import { backendFailureMeta, humanizeBackendFailure } from "./backend-failure-text.ts";
import { maybeNudgeForContextUsage, refreshContextUsage } from "../context-usage.ts";

// Persistent consumer. Runs for the session's lifetime, iterating `stream()`
// in a loop so events that arrive between turns (notably `task_notification`
// from backgrounded Bash) get processed promptly instead of being held until
// the next user turn. See docs/investigations/held-back-messages-investigation.md.
//
// Bound to a specific session instance: loop exits when `managed.session` is
// swapped out (abort / resume / fork / etc.) - `session.close()` unblocks the
// parked `stream()` generator.
export async function runConsumer(agentId: string, managed: ManagedAgent, boundSession: BackendSession) {
  try {
    for await (const ev of boundSession.stream()) {
      if (managed.session !== boundSession) continue;
      if (managed.aborting && ev.kind !== "turn_completed" && ev.kind !== "error") continue;
      processNormalizedEvent(agentId, ev);
    }
  } catch (err: any) {
    if (managed.aborting || managed.session !== boundSession) return;
    const turn = managed.pendingTurn;
    managed.pendingTurn = null;
    clearLiveTurn(managed);
    if (turn) turn.reject(err);
    const raw = err.message ?? String(err);
    const failure = humanizeBackendFailure(raw);
    const errorText = failure.text.startsWith("Stream error:") ? failure.text : `Stream error: ${failure.text}`;
    addLogEntry(agentId, "error", errorText, backendFailureMeta(failure));
    if (managed.info.agentType === "claude") {
      const hints = diagnoseProcessExit(managed);
      if (hints) emitEphemeralLog(agentId, "system", hints);
    }
    emitLoginInstructionsIfAuth(agentId, managed, raw);
    updateState(agentId, isAuthErrorForAgent(managed, raw) ? "waiting_for_response" : "error");
  }
}

function deriveStateFromEvent(ev: NormalizedEvent): AgentState | null {
  switch (ev.kind) {
    case "assistant_text":
    case "thinking":
      return "thinking";
    case "tool_call":
      return "tool_executing";
    case "turn_completed":
      return ev.status === "completed" ? "waiting_for_response" : null;
    default:
      return null;
  }
}

type ApprovalRequestEvent = Extract<NormalizedEvent, { kind: "approval_request" }>;

function approvalPromptLines(ev: ApprovalRequestEvent): string[] {
  const lines = [`**${ev.title ?? `Wants to use ${ev.toolName}`}**`];
  if (ev.description) lines.push(ev.description);
  lines.push("", "Reply:", "  1. Allow \u2014 and don't ask again for similar calls this session", "  2. Allow \u2014 just this time", "  3. Deny");
  if (ev.allowPrefixLabel) {
    lines.push(`  4. Allow \u2014 and don't ask again this session for any command starting with \`${ev.allowPrefixLabel}\``);
    if (ev.allowPrefixExample) {
      lines.push(`     Reply \`4 <prefix>\` to choose how much to allow, e.g. \`4 ${ev.allowPrefixExample}\`.`);
    }
  }
  lines.push("", "Or type any other message to deny with that as the reason.");
  return lines;
}

export function showPermissionPrompt(agentId: string, managed: ManagedAgent, ev: ApprovalRequestEvent) {
  emitEphemeralLog(agentId, "system", approvalPromptLines(ev).join("\n"));
  managed.pendingPermission = { approvalId: ev.approvalId, toolName: ev.toolName, ...(ev.allowPrefixLabel ? { allowPrefixLabel: ev.allowPrefixLabel } : {}) };
  updateState(agentId, "waiting_for_response");
}

export function showNextPermissionPrompt(agentId: string, managed: ManagedAgent) {
  if (managed.pendingPermission) return;
  for (;;) {
    const next = managed.queuedPermissions.shift();
    if (!next) {
      syncPendingPrompt(agentId, managed);
      return;
    }
    if (next.session === managed.session) {
      showPermissionPrompt(agentId, managed, next.event);
      return;
    }
  }
}

function processNormalizedEvent(agentId: string, ev: NormalizedEvent) {
  const eventManaged = agents.get(agentId);
  if (eventManaged) eventManaged.lastNormalizedEventAt = Date.now();
  const newState = deriveStateFromEvent(ev);
  const derivesBusyState = newState === "thinking" || newState === "tool_executing";
  const eventHasLiveTurn = eventManaged?.turnStartedAt !== 0;
  if (newState && (!derivesBusyState || eventHasLiveTurn)) {
    const currentState = agents.get(agentId)?.info.state;
    if (!(currentState === "tool_executing" && newState === "thinking")) updateState(agentId, newState);
  }

  switch (ev.kind) {
    case "system_init": {
      const managed = agents.get(agentId);
      if (managed && ev.sessionId) {
        const hadPreviousSession = !!managed.sessionId;
        if (!managed.sessionId) {
          const history = loadLogWithAncestors(agentId, ev.sessionId);
          for (const entry of history) emit({ type: "log_entry", entry });
        }
        if (hadPreviousSession && ev.sessionId !== managed.sessionId) {
          emit({ type: "clear_logs", agentId });
          addLogEntry(agentId, "system", "Conversation cleared.");
        }
        managed.sessionId = ev.sessionId;
        // Record the cwd this session was born in (source of truth for
        // per-session cwd). Idempotent: a fork already stamped its cwd via
        // persistSessionFork so this no-ops there; a plain fresh session
        // (spawn / new conversation) gets the agent's current mirror cwd here.
        ensureSessionCwd(agentId, ev.sessionId, managed.info.cwd);
        if (managed.info.agentType === "claude" && managed.launchedClaudeConfigDir) {
          ensureSessionClaudeConfigDir(agentId, ev.sessionId, managed.launchedClaudeConfigDir);
        }
        if (!hadPreviousSession) {
          for (const entry of logCache.get(agentId) ?? []) appendLog(agentId, ev.sessionId, entry);
        }
        persistAll();
      }
      const filteredSdkCommands = (ev.slashCommands ?? []).filter((c) => !c.startsWith("mcp__"));
      if (managed) {
        managed.sdkReportedCommands = filteredSdkCommands;
        managed.slashCommands = autocompleteCommands();
        managed.skills = deduplicateSkills([...discoverUserSkills(), ...discoverProjectSkills(managed.info.cwd), ...discoverPluginSkills(), ...discoverBundledSkills()]);
        emit({ type: "slash_commands", agentId, commands: managed.slashCommands, skills: managed.skills });
      }
      break;
    }
    case "assistant_text":
      addLogEntry(agentId, "text", ev.text);
      break;
    case "system_text": {
      const managed = agents.get(agentId);
      // Bureau-authored breadcrumbs skip the auth sniff: they quote commands
      // and rules (a command containing `401` is not a sign-in problem), and
      // being ours they can never BE a provider auth notice.
      if (!ev.bureauAuthored && isAuthErrorForAgent(managed, ev.text)) {
        emitLoginInstructionsImpl(agentId, managed);
        break;
      }
      addLogEntry(agentId, "system", ev.text);
      break;
    }
    case "task_lifecycle":
      addLogEntry(agentId, "system", ev.label, { taskEvent: { phase: ev.phase, taskId: ev.taskId } });
      break;
    case "provider_capacity_retry":
      addLogEntry(agentId, "system", `Provider is at capacity. Retrying in ${ev.delayMs / 1_000}s (${ev.attempt + 1}/${ev.maxAttempts}).`);
      break;
    case "permission_denied":
      addLogEntry(agentId, "system", ev.decisionReason || ev.message || `${ev.toolName} denied.`, {
        permissionDenied: {
          toolUseId: ev.toolUseId,
          toolName: ev.toolName,
          message: ev.message,
          ...(ev.decisionReason ? { decisionReason: ev.decisionReason } : {}),
          ...(ev.agentId ? { agentId: ev.agentId } : {}),
        },
      });
      break;
    case "thinking": {
      const managed = agents.get(agentId);
      const duration_ms = ev.durationMs ?? (managed?.thinkingStartedAt ? Date.now() - managed.thinkingStartedAt : undefined);
      addLogEntry(agentId, "thinking", ev.text, duration_ms != null ? { duration_ms } : undefined);
      break;
    }
    case "tool_call": {
      const managed = agents.get(agentId);
      if (managed) {
        managed.toolCallTimestamps.set(ev.toolUseId, {
          name: ev.name,
          startedAt: Date.now(),
        });
      }
      // metadata.subagent marks a call the agent's SUBAGENT made rather than
      // the agent itself. Absent for the agent's own calls, for Codex, and
      // for every entry written before this field existed.
      addLogEntry(agentId, "tool_call", ev.name, { toolId: ev.toolUseId, input: ev.input, ...(ev.subagent ? { subagent: ev.subagent } : {}) });
      break;
    }
    case "tool_result": {
      const managed = agents.get(agentId);
      const callStart = managed?.toolCallTimestamps.get(ev.toolUseId);
      const duration_ms = ev.durationMs ?? (callStart ? Date.now() - callStart.startedAt : undefined);
      if (managed && callStart) managed.toolCallTimestamps.delete(ev.toolUseId);
      addLogEntry(
        agentId,
        "tool_result",
        ev.content.slice(0, 10000),
        { toolUseId: ev.toolUseId, ...(duration_ms != null ? { duration_ms } : {}), ...(ev.isError != null ? { isError: ev.isError } : {}), ...(ev.subagent ? { subagent: ev.subagent } : {}) },
        ev.attachments,
      );
      break;
    }
    case "turn_completed": {
      const managed = agents.get(agentId);
      if (managed?.sessionId && ev.usage) {
        const cumulative = accumulateSessionUsage(agentId, managed.sessionId, ev.usage, ev.cost ?? 0);
        if (managed.lastWrittenEntryId) appendSessionUsageSnapshot(agentId, managed.sessionId, managed.lastWrittenEntryId, cumulative);
      }
      if (managed && ev.status !== "completed") {
        const isInterrupted = managed.aborting && ev.status === "interrupted";
        if (!isInterrupted) {
          const raw = ev.error ?? `Agent stopped: ${ev.status}.`;
          if (ev.causedByProviderCapacity === true) {
            addLogEntry(agentId, "error", "The provider is still at capacity after retries. Try again in a bit.", { backendFailureRaw: raw });
            updateState(agentId, "waiting_for_response");
          } else {
            const failure = humanizeBackendFailure(raw);
            const errorText = failure.text;
            addLogEntry(agentId, "error", errorText, backendFailureMeta(failure));
            const auth = ev.causedByAuth === true || isAuthErrorForAgent(managed, raw);
            if (ev.causedByAuth !== true && auth) emitLoginInstructionsImpl(agentId, managed);
            updateState(agentId, auth ? "waiting_for_response" : "error");
          }
        }
      }
      const turn = managed?.pendingTurn;
      if (managed) clearLiveTurn(managed);
      if (managed && turn) {
        managed.pendingTurn = null;
        if (ev.causedByProviderCapacity === true) turn.reject(new ProviderCapacityError(ev.error ?? "Provider capacity"));
        else turn.resolve();
      }
      if (managed && ev.status === "completed") void refreshContextUsage(agentId, managed).then(() => maybeNudgeForContextUsage(agentId, managed));
      break;
    }
    case "usage_update": {
      const managed = agents.get(agentId);
      if (managed?.sessionId) {
        const cumulative = accumulateSessionUsage(agentId, managed.sessionId, ev.tokenUsage, 0);
        if (managed.lastWrittenEntryId) appendSessionUsageSnapshot(agentId, managed.sessionId, managed.lastWrittenEntryId, cumulative);
      }
      break;
    }
    case "compacted":
      addLogEntry(agentId, "system", ev.summary ? `Context compacted: ${ev.summary}` : "Context compacted.");
      break;
    case "file_view":
      addLogEntry(agentId, "file-view", ev.title, undefined, ev.attachments);
      break;
    case "error": {
      const managed = agents.get(agentId);
      const failure = humanizeBackendFailure(ev.message);
      addLogEntry(agentId, "error", failure.text, backendFailureMeta(failure));
      if (managed?.info.agentType === "claude") {
        const hints = diagnoseProcessExit(managed);
        if (hints) emitEphemeralLog(agentId, "system", hints);
      }
      // Auth classification must stay on the raw backend text, not the humanized sentence.
      emitLoginInstructionsIfAuth(agentId, managed, ev.message);
      const turn = managed?.pendingTurn;
      if (managed) clearLiveTurn(managed);
      if (managed && turn) {
        managed.pendingTurn = null;
        turn.reject(new Error(ev.message));
      }
      updateState(agentId, managed && isAuthErrorForAgent(managed, ev.message) ? "waiting_for_response" : "error");
      break;
    }
    case "approval_request": {
      const managed = agents.get(agentId);
      if (!managed) break;
      if (managed.pendingPermission || (managed.queuedPermissions?.length ?? 0) > 0) {
        managed.queuedPermissions.push({ event: ev, session: managed.session });
        syncPendingPrompt(agentId, managed);
        break;
      }
      showPermissionPrompt(agentId, managed, ev);
      break;
    }
  }
}
