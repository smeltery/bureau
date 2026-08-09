// Every decision the subscription pill makes, extracted from the component so
// it can be tested without a React render harness (same split as
// ContextMeter's contextMeterView / appVerbs).
//
// The pill answers a different question than the context battery beside it: the
// battery is "how full is THIS conversation", the pill is "how much of the PLAN
// the backend account is signed in to has been burned". The number comes from
// whichever window is closest to its limit (the server picks it and says so in
// `primaryIndex`); every window the backend reports is a popover row, and the
// leading one is marked there so the number is never ambiguous.
//
// It shares the battery's LIFECYCLE: the pill always renders, and with no
// reading it shows an empty ring and "?" in a ghost color rather than
// disappearing. An indicator that comes and goes is one the eye stops trusting,
// and a missing pill and a zero-usage pill looked the same. The unknown copy
// says outright that some sessions never report one, so the "?" doesn't imply a
// number is hiding somewhere.

import type { AgentSubscriptionUsage, AgentSubscriptionWindow } from "../../../shared/types.ts";
import { contextMeterColor } from "./ContextMeter.tsx";
import type { UsagePin } from "../../device-settings.ts";

// A reading younger than this is presented as current; only older ones get the
// "Reading taken N ago" line in the popover.
export const STALE_READING_MS = 15 * 60 * 1000;

// The one non-data string in the popover's chooser. "Auto" alone wouldn't say
// auto-WHAT, and the parenthetical is the whole rule in two words.
export const AUTO_CHOICE_LABEL = "Auto (most constrained)";
export const CHOOSER_HINT = "Which limit the number tracks:";

// Shown in place of the window list when there is no reading. Second sentence
// exists so the "?" isn't read as "a number exists and we lost it": an API key
// / Bedrock / Vertex session has no plan quota to report at all.
export const UNKNOWN_USAGE_TEXT = "Plan usage not reported yet. It updates when the agent finishes a turn - sessions without plan limits (API key, Bedrock, Vertex) never report one.";

export const USAGE_CAVEAT = "This is account-wide, not per agent.";

// A short local date-and-time ("Sat 1 Aug, 09:00") in the viewer's own
// timezone — the reset matters to whoever is looking at the screen, not to the
// server.
export function formatResetAt(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

// "2 days 5 hours" / "3 hours 10 min" / "12 min" — rounded, never seconds.
export function formatTimeUntil(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days && hours) return `${plural(days, "day")} ${plural(hours, "hour")}`;
  if (days) return plural(days, "day");
  if (hours) return `${plural(hours, "hour")} ${minutes} min`;
  return `${minutes} min`;
}

// One line per window: "Weekly: 34% used - resets Sat 1 Aug, 09:00 (in 2 days
// 5 hours)". Plain spaced hyphens, never em dashes.
// `nowMs` is null for the hover tooltip, which renders on every re-render and
// so must stay a pure function of the props — only the popover, whose clock is
// stamped when it opens, gets the countdown.
export function windowLine(w: AgentSubscriptionWindow, nowMs: number | null): string {
  const head = `${w.label}: ${Math.round(w.usedPercent)}% used`;
  if (w.resetsAtMs === null) return head;
  const at = formatResetAt(w.resetsAtMs);
  if (nowMs === null || w.resetsAtMs <= nowMs) return `${head} - resets ${at}`;
  return `${head} - resets ${at} (in ${formatTimeUntil(w.resetsAtMs - nowMs)})`;
}

// Which window the number tracks, given the server's auto pick and the
// viewer's pin.
//
// Window labels are NOT unique in general — two Codex windows of equal duration
// render identically, and a server-supplied Claude model_scoped name can
// collide with a fixed one — so a label-only lookup could silently track a
// different limit than the row that was clicked. A pin therefore carries both
// the label and the index it was clicked at, resolved in this order:
//   1. the stored index still holds that label -> use it. Exact, and the only
//      branch that can tell two same-labelled rows apart.
//   2. the label appears exactly once elsewhere -> use that. This is the
//      provider reordering its windows, where the index is stale but the
//      intent is unambiguous.
//   3. anything else — the window is gone, or the label is now ambiguous and
//      we cannot tell which row was meant -> fall back to auto. Showing the
//      most constrained window is always defensible; tracking the wrong limit
//      while claiming to be pinned is not.
export function resolveTrackedWindow(windows: AgentSubscriptionWindow[], primaryIndex: number, pin: UsagePin | null): { index: number; pinned: boolean } {
  if (pin) {
    if (windows[pin.index]?.label === pin.label) return { index: pin.index, pinned: true };
    const matches: number[] = [];
    windows.forEach((w, i) => {
      if (w.label === pin.label) matches.push(i);
    });
    if (matches.length === 1) return { index: matches[0]!, pinned: true };
  }
  // Validate rather than trust: an out-of-range index from an older server
  // must not blank the pill or crash the header.
  const auto = primaryIndex >= 0 && primaryIndex < windows.length ? primaryIndex : 0;
  return { index: auto, pinned: false };
}

// Everything the pill draws, for one reading (or the absence of one). Colour and
// fill come from the RAW clamped percentage; the number is only rounded for the
// label — same contract as the context battery, whose bands key off the raw
// float. Rounding first would paint 49.6% orange, i.e. a different threshold
// than the one the two indicators are supposed to share.
export interface SubscriptionPillView {
  // The usable reading, or null. Narrowing it once keeps every derived value on
  // a single fork instead of re-testing `usage` each time; the pill renders
  // either way.
  reading: AgentSubscriptionUsage | null;
  tracked: { index: number; pinned: boolean } | null;
  headline: AgentSubscriptionWindow | null;
  rawUsed: number;
  used: number;
  color: string;
  // "?" is plain ASCII on purpose — no iOS auto-emoji risk (unlike ？/⍰), same
  // rule the battery's unknown label follows.
  label: string;
  planLine: string | null;
  hoverLines: string[];
  tooltip: string;
  ariaLabel: string;
}

export function subscriptionPillView(usage: AgentSubscriptionUsage | null | undefined, pin: UsagePin | null): SubscriptionPillView {
  const reading = usage && usage.windows.length > 0 ? usage : null;
  const tracked = reading ? resolveTrackedWindow(reading.windows, reading.primaryIndex, pin) : null;
  const headline = reading && tracked ? reading.windows[tracked.index]! : null;
  const rawUsed = headline ? Math.max(0, Math.min(100, headline.usedPercent)) : 0;
  const used = Math.round(rawUsed);
  const planLine = reading?.plan ? `Plan: ${reading.plan}` : null;
  const hoverLines = reading ? reading.windows.map((w) => windowLine(w, null)) : [];
  return {
    reading,
    tracked,
    headline,
    rawUsed,
    used,
    color: reading ? contextMeterColor(rawUsed) : "var(--text-ghost)",
    label: reading ? `${used}%` : "?",
    planLine,
    hoverLines,
    tooltip: reading ? [...(planLine ? [planLine] : []), ...hoverLines, USAGE_CAVEAT].join("\n") : UNKNOWN_USAGE_TEXT,
    ariaLabel: headline && tracked ? `${headline.label} plan allowance ${used}% used${tracked.pinned ? ", pinned" : ""}. Tap for details.` : "Plan usage not reported yet. Tap for details.",
  };
}

// How old the reading is. Account data goes stale while an agent sits idle
// (nothing refreshes it between turns), so the popover says so rather than
// presenting a week-old number as current — but a fresh reading stays
// unannotated: the line should only appear when it is actually stale.
export function readingAgeLine(reading: AgentSubscriptionUsage | null, nowMs: number | null): string | null {
  if (!reading || nowMs === null) return null;
  const age = nowMs - reading.sampledAtMs;
  return age > STALE_READING_MS ? `Reading taken ${formatTimeUntil(age)} ago.` : null;
}
