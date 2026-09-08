import type { ManagedAgent } from "./state.ts";
import { addLogEntry, emit, emitEphemeralLog } from "./state.ts";

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

// Shared fullness bands for the agent-facing nudge and the boss-facing
// ephemeral chat line. Separate fired-sets keep the two audiences independent.
//
// minWindowTokens gates a band on the reported window size: the 50 band is an
// early budget warning that on a small window (e.g. Codex ~250k / Sonnet 200k)
// fires within a few turns and reads as noise, while the 75 wrap-up band stays
// useful at any size. Keyed on maxTokens, not agentType, so it self-adjusts.
export const CONTEXT_NOTICE_BANDS = [
  { pct: 50, minWindowTokens: 500_000 },
  { pct: 75, minWindowTokens: 0 },
] as const;

export type ContextNoticeThreshold = (typeof CONTEXT_NOTICE_BANDS)[number]["pct"];

/** Highest unfired band the snapshot clears, or null. */
export function pickContextThreshold(percentage: number, maxTokens: number, fired: ReadonlySet<number>): ContextNoticeThreshold | null {
  let chosen: ContextNoticeThreshold | null = null;
  for (const band of CONTEXT_NOTICE_BANDS) {
    if (maxTokens < band.minWindowTokens) continue;
    if (percentage >= band.pct && !fired.has(band.pct)) chosen = band.pct;
  }
  return chosen;
}

function markBandsThrough(fired: Set<number>, chosen: number) {
  for (const band of CONTEXT_NOTICE_BANDS) {
    if (band.pct <= chosen) fired.add(band.pct);
  }
}

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
  // Sample-commit path: boss-facing notice is server-authoritative so reconnects
  // cannot duplicate it. Agent-facing nudge stays on the turn-completed caller.
  maybeEmitUiContextNotice(agentId, managed);
  return snapshot;
}

/**
 * Boss-facing ephemeral chat line when context crosses a band. Distinct from
 * the agent-facing nudge (separate fired-set). Codex is opted out: its harness
 * owns compaction and /clear advice is less actionable there. If the first
 * sample already clears both bands, only the highest emits a line; lower bands
 * are consumed.
 */
export function maybeEmitUiContextNotice(agentId: string, managed: ManagedAgent) {
  if (managed.info.agentType === "codex") return;
  const usage = managed.info.contextUsage;
  if (!usage) return;
  const chosen = pickContextThreshold(usage.percentage, usage.maxTokens, managed.firedUiThresholds);
  if (chosen === null) return;
  markBandsThrough(managed.firedUiThresholds, chosen);
  const pct = Math.round(usage.percentage);
  emitEphemeralLog(agentId, "system", `Context is ${pct}% full. Consider starting to wrap up. You can use /clear (for a new session) or /handoff (to continue this one with fresh context).`, {
    contextUsage: usage,
    contextThreshold: chosen,
    contextAudience: "ui",
  });
}

export function maybeNudgeForContextUsage(agentId: string, managed: ManagedAgent) {
  if (managed.info.agentType === "codex") return;
  const usage = managed.info.contextUsage;
  if (!usage) return;
  const threshold = pickContextThreshold(usage.percentage, usage.maxTokens, managed.contextNudgesSent);
  if (threshold === null) return;
  markBandsThrough(managed.contextNudgesSent, threshold);
  const notice =
    threshold === 75
      ? "Context budget notice: your context is over 75% full. Start wrapping up now: summarize current state, preserve important decisions, and suggest a handoff or /clear soon."
      : "Context budget notice: your context is over 50% full. Keep an eye on scope and start nudging the work toward a clean checkpoint.";
  managed.pendingContextNotices.push(notice);
  addLogEntry(agentId, "system", notice, { contextUsage: usage, contextThreshold: threshold, contextAudience: "agent" });
}
