import { handoffTokens } from "../../../shared/agents/handoff.ts";
import { withAuditContext } from "../../audit/context.ts";
import { recordAuditEvent } from "../../audit/store.ts";
import type { BackendSession, NormalizedEvent } from "../../backends/types.ts";
import { agents, addLogEntry, updateState, type ManagedAgent } from "../state.ts";
import { runAgentTurn } from "../../plugins/run-agent-turn.ts";
import { handoff } from "./control.ts";
import { flushQueue } from "./message-queue.ts";

export interface AutoHandoffAttempt {
  session: BackendSession;
  cancelToken: number;
  chunks: string[];
  capturing: boolean;
  status: "completed" | "interrupted" | "failed" | null;
}

export function handoffThreshold(sample: { maxTokens: number; compactAtTokens?: number }, tokens?: number): number {
  const limits = [handoffTokens(tokens), sample.maxTokens * 0.85];
  if (sample.compactAtTokens && sample.compactAtTokens > 0) limits.push(sample.compactAtTokens - sample.maxTokens * 0.05);
  return Math.max(1, Math.min(...limits));
}

export function resetAutoHandoff(managed: ManagedAgent): void {
  managed.autoHandoffAttempt = null;
  managed.autoHandoffSpent = false;
  managed.autoHandoffFresh = false;
}

export function cancelAutoHandoff(managed: ManagedAgent): void {
  if (managed.autoHandoffAttempt) managed.autoHandoffSpent = true;
  managed.autoHandoffAttempt = null;
}

export function observeAutoHandoff(managed: ManagedAgent, event: NormalizedEvent): void {
  const attempt = managed.autoHandoffAttempt;
  if (attempt?.capturing) {
    if (event.kind === "assistant_text") attempt.chunks.push(event.text);
    if (event.kind === "tool_call" && !event.subagent) attempt.chunks = [];
    if (event.kind === "turn_completed") attempt.status = event.status;
    return;
  }
  if (
    event.kind !== "turn_completed" ||
    event.status !== "completed" ||
    event.usageLimitResetAt !== undefined ||
    !managed.info.autoHandoff ||
    managed.autoHandoffSpent ||
    attempt ||
    !managed.session ||
    managed.aborting
  )
    return;
  // Arm before the completion event publishes idle state, so queued messages
  // cannot take the context budget reserved for the brief.
  const next: AutoHandoffAttempt = { session: managed.session, cancelToken: managed.turnCancelToken, chunks: [], capturing: false, status: null };
  managed.autoHandoffAttempt = next;
  const pending = managed.pendingTurn?.promise;
  void attemptHandoff(managed, next, pending);
}

async function attemptHandoff(managed: ManagedAgent, attempt: AutoHandoffAttempt, pending?: Promise<void>) {
  const id = managed.info.id;
  const current = () => agents.get(id) === managed && managed.autoHandoffAttempt === attempt && managed.session === attempt.session && managed.turnCancelToken === attempt.cancelToken;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const sample = await Promise.race([
      attempt.session.getContextUsage(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 10_000);
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (pending) await pending.catch(() => {});
    if (!current() || !managed.info.autoHandoff) return;
    if (!sample || !Number.isFinite(sample.maxTokens) || sample.maxTokens <= 0) return;
    if (sample.totalTokens < handoffThreshold(sample, managed.info.autoHandoffTokens)) {
      managed.autoHandoffFresh = false;
      return;
    }
    managed.autoHandoffSpent = true;
    if (managed.autoHandoffFresh) {
      managed.autoHandoffFresh = false;
      addLogEntry(id, "system", "Automatic handoff paused: the fresh conversation already exceeds its context threshold. Reduce persistent instructions or use a larger context window.");
      return;
    }
    if (
      managed.pendingPermission ||
      managed.queuedPermissions.length ||
      managed.pendingResume ||
      managed.pendingModelPick ||
      managed.pendingEffortPick ||
      managed.pendingCronjobPick ||
      managed.info.sessionSwapping ||
      managed.abortPromise
    )
      return;
    attempt.capturing = true;
    addLogEntry(id, "system", `Context reached ${Math.round(sample.percentage)}% (${sample.totalTokens.toLocaleString("en-US")} tokens). Writing an automatic handoff brief.`);
    const prompt =
      "Bureau is preparing a fresh conversation because this context is nearly full. Reply only with a concise handoff brief: the current goal, next concrete steps, important working state, decisions, open questions, and file or task pointers. Omit a session recap and material already in memory or persistent instructions. Do not call a handoff route.";
    await runAgentTurn({ managed, visibleText: prompt, originalText: prompt, sdkText: prompt, origin: "queued", humanInput: false, username: null });
    if (!current()) return;
    const brief = attempt.chunks.join(managed.info.agentType === "opencode" ? "" : "\n\n").trim();
    if (attempt.status !== "completed" || !brief) {
      addLogEntry(id, "system", "Automatic handoff could not produce a brief. This conversation and its queued messages are preserved; use /handoff when ready.");
      return;
    }
    managed.autoHandoffAttempt = null;
    const result = await handoff(id, `[Automatic handoff: continue from the brief below. Look up earlier conversations when details are missing.]\n\n${brief}`, { automatic: true });
    if (result.ok) withAuditContext({ actor: `automatic-handoff:${id}`, operation: "agents.handoff" }, () => recordAuditEvent(id, ["conversation"]));
    if (!result.ok) {
      managed.autoHandoffSpent = true;
      addLogEntry(id, "system", `Automatic handoff did not complete: ${result.error}`);
    }
  } catch (error) {
    if (current()) {
      managed.autoHandoffSpent = true;
      addLogEntry(id, "system", "Automatic handoff failed. The conversation is preserved; check the connection and use /handoff when ready.");
      console.error(`[auto-handoff] ${id}:`, error instanceof Error ? error.message : "unknown failure");
      if (managed.info.state === "thinking") updateState(id, "waiting_for_response");
    }
  } finally {
    if (timer) clearTimeout(timer);
    if (managed.autoHandoffAttempt === attempt) managed.autoHandoffAttempt = null;
    if (agents.get(id) === managed && managed.turnCancelToken === attempt.cancelToken && !managed.aborting) void flushQueue(id);
  }
}
