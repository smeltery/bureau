import type { ManagedAgent } from "./state.ts";
import { addLogEntry, emit } from "./state.ts";

export type AgentContextUsageResponse =
  | {
      available: true;
      model: string;
      totalTokens: number;
      maxTokens: number;
      percentage: number;
      sampledAtMs: number;
    }
  | { available: false; reason: "no_session" | "not_yet_measured" };

export async function getAgentContextUsage(agentId: string, managed: ManagedAgent | undefined): Promise<AgentContextUsageResponse> {
  if (!managed) return { available: false, reason: "no_session" };
  if (!managed.session && !managed.sessionId) return { available: false, reason: "no_session" };
  if (!managed.session) return { available: false, reason: "not_yet_measured" };

  const refreshed = await refreshContextUsage(agentId, managed);
  if (!refreshed) return { available: false, reason: "not_yet_measured" };
  return { available: true, ...refreshed };
}

export async function refreshContextUsage(agentId: string, managed: ManagedAgent) {
  if (!managed.session) return null;
  const ctx = await managed.session.getContextUsage().catch(() => null);
  if (!ctx) return null;
  const snapshot = {
    model: ctx.model,
    totalTokens: ctx.totalTokens,
    maxTokens: ctx.maxTokens,
    percentage: ctx.percentage,
    sampledAtMs: Date.now(),
  };
  managed.info = { ...managed.info, contextUsage: snapshot };
  emit({ type: "agent_updated", agentId, changes: { contextUsage: snapshot } });
  return snapshot;
}

export function maybeNudgeForContextUsage(agentId: string, managed: ManagedAgent) {
  const usage = managed.info.contextUsage;
  if (!usage) return;
  const threshold = usage.percentage >= 75 ? 75 : usage.percentage >= 50 ? 50 : null;
  if (!threshold || managed.contextNudgesSent.has(threshold)) return;
  managed.contextNudgesSent.add(threshold);
  const notice =
    threshold === 75
      ? "Context budget notice: your context is over 75% full. Start wrapping up now: summarize current state, preserve important decisions, and suggest a handoff or /clear soon."
      : "Context budget notice: your context is over 50% full. Keep an eye on scope and start nudging the work toward a clean checkpoint.";
  managed.pendingContextNotices.push(notice);
  addLogEntry(agentId, "system", notice, { contextUsage: usage, contextThreshold: threshold });
}
