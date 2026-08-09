// Subscription-allowance usage: the pill beside the context battery.
//
// A THIRD read path, distinct from both context fullness and token accounting:
// how much of the signed-in ACCOUNT's plan allowance is spent. Account-scoped,
// so unlike fullness it deliberately survives /clear, fork and same-engine
// resume — the quota doesn't reset when a conversation does.
//
// Refresh cadence is deliberately NOT policed here. The reading is refreshed on
// demand (the header pill asks at every turn boundary), and each backend decides
// what that costs it: Codex reads rate limits its app-server already pushed,
// Claude throttles its control RPC internally.

import type { AgentSubscriptionUsage, AgentSubscriptionWindow } from "../../shared/types.ts";
import type { SubscriptionUsage, SubscriptionUsageResult } from "./types.ts";

// The slice of ManagedAgent this module reads and writes. Declared structurally
// so the commit protocol can be tested without building a whole ManagedAgent,
// and so server/agents/ owns the field declarations.
export interface SubscriptionUsageState {
  session: { getSubscriptionUsage?: () => Promise<SubscriptionUsageResult> } | null;
  // The backend engine the reading belongs to. Used as the ACCOUNT identity:
  // switching engines repoints the agent at a different provider account, so
  // the previous number is not just stale but wrong. A same-engine model change
  // deliberately does NOT invalidate — swapping Opus for Sonnet leaves the
  // claude.ai account, and therefore the allowance, exactly where it was.
  info: { agentType: string };
  subscriptionUsage?: AgentSubscriptionUsage | null;
  subscriptionUsageAccount?: string | null;
  subscriptionSampleSeq?: number;
  subscriptionCommittedSeq?: number;
}

// Which window the pill's NUMBER comes from: the one closest to its limit.
// The alternative (always the weekly window) can read green while a 5-hour
// or per-model window sits at 95%, which is precisely the situation the pill
// exists to surface. Ties go to the earlier window in the backend's display
// order, so the choice is stable across samples. The popover still lists
// every window, and the pill's accessible name says which one it's showing.
export function pickPrimaryWindow(windows: AgentSubscriptionWindow[]): number {
  let best = 0;
  for (let i = 1; i < windows.length; i++) {
    if (windows[i]!.usedPercent > windows[best]!.usedPercent) best = i;
  }
  return best;
}

// Backend reading -> wire snapshot, or null when there is no usable window.
export function toSubscriptionUsageSnapshot(usage: SubscriptionUsage, sampledAtMs: number): AgentSubscriptionUsage | null {
  if (usage.windows.length === 0) return null;
  const windows: AgentSubscriptionWindow[] = usage.windows.map((w) => ({
    label: w.label,
    // Clamp again at the wire boundary: the adapters clamp too, but a
    // malformed reading must never paint a negative or overflowing gauge.
    usedPercent: Math.max(0, Math.min(100, w.usedPercent)),
    resetsAtMs: w.resetsAtMs,
  }));
  return { plan: usage.plan, windows, primaryIndex: pickPrimaryWindow(windows), sampledAtMs };
}

// Refresh and return the committed reading. A sample commits only if BOTH
// guards still hold: the account identity captured at initiation and the
// monotonic seq. There is deliberately no session-identity guard — the reading
// belongs to the ACCOUNT, so a late resolution from a session that has since
// been replaced is still true; only a switch to a different account invalidates
// it, which is what the account guard catches.
//
// The three backend answers are handled differently, which is the whole point
// of the tri-state (see SubscriptionUsageResult): a reading commits, an
// AUTHORITATIVE "no plan allowance here" clears the pill, and "we learned
// nothing this time" leaves the last reading standing so one failed RPC can't
// blank a valid number.
export async function refreshSubscriptionUsage(managed: SubscriptionUsageState | undefined, nowMs: () => number = Date.now): Promise<AgentSubscriptionUsage | null> {
  if (!managed) return null;
  // Account-identity check, synchronous and before anything else: a reading
  // taken under the other engine describes a different provider account, so it
  // goes now rather than lingering until the new one answers.
  const account = managed.info.agentType;
  if (managed.subscriptionUsageAccount !== account) {
    managed.subscriptionUsageAccount = account;
    managed.subscriptionUsage = null;
  }
  const read = managed.session?.getSubscriptionUsage;
  // No session, or a backend that can't report it at all: the pill shows its
  // unknown state rather than a number nobody can source.
  if (!read || !managed.session) return managed.subscriptionUsage ?? null;

  const seq = (managed.subscriptionSampleSeq ?? 0) + 1;
  managed.subscriptionSampleSeq = seq;
  let result: SubscriptionUsageResult;
  try {
    result = await read.call(managed.session);
  } catch {
    // Backends are contracted to resolve rather than reject; this is
    // belt-and-braces so a surprise can't take the request down with it.
    return managed.subscriptionUsage ?? null;
  }
  // Nothing learned — keep whatever was displayed, without burning the seq.
  if (result.kind === "unknown") return managed.subscriptionUsage ?? null;
  // Both guards, in both directions: neither an older in-flight sample nor one
  // belonging to a previous account can undo a newer reading, and an
  // authoritative CLEAR commits through the same guard as a reading.
  if (managed.subscriptionUsageAccount !== account) return managed.subscriptionUsage ?? null;
  if (seq <= (managed.subscriptionCommittedSeq ?? 0)) return managed.subscriptionUsage ?? null;
  managed.subscriptionCommittedSeq = seq;
  managed.subscriptionUsage = result.kind === "usage" ? toSubscriptionUsageSnapshot(result.usage, nowMs()) : null;
  return managed.subscriptionUsage;
}
