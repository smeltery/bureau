// Claude plan-allowance reading: the data behind the header's usage pill.
//
// Source is the SDK's structured `/usage` control call, which ships under a
// name that shouts it may change or vanish in any release
// (usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET). Bureau treats
// its very existence as a runtime question and validates every field it
// returns, so a future SDK rename turns the pill off instead of failing the
// build or throwing mid-turn.

import type { SubscriptionUsageResult, SubscriptionUsageWindow } from "./types.ts";

// Which claude.ai rate-limit windows bureau surfaces, in DISPLAY order (the
// pill picks its number by usage, not by this order — see
// server/backends/subscription-usage.ts). seven_day leads because it's the one
// people mean by "my plan allowance"; the shorter and per-model windows follow.
//
// seven_day_oauth_apps is deliberately left out: it meters third-party OAuth
// apps rather than this session. The SDK's own live gating signal
// (SDKRateLimitInfo.rateLimitType, the field that says which limit actually
// rejected a request) enumerates five_hour / seven_day / seven_day_opus /
// seven_day_sonnet / overage and never oauth_apps, so surfacing it would put
// a number on screen that can't explain anything the agent runs into.
// extra_usage (overage credits) is a different currency and stays out too.
const CLAUDE_RATE_LIMIT_WINDOWS: { key: string; label: string }[] = [
  { key: "seven_day", label: "Weekly" },
  { key: "five_hour", label: "5-hour" },
  { key: "seven_day_opus", label: "Weekly (Opus)" },
  { key: "seven_day_sonnet", label: "Weekly (Sonnet)" },
];

// Minimum gap between actual /usage control RPCs per conversation. The pill
// refreshes at every turn boundary, and for Codex that's a cache read of pushed
// data — but for Claude it's a round trip to the CLI. Throttling HERE rather
// than in the caller keeps the cost policy with the backend that pays it, and
// keeps Codex's cheap path unthrottled.
export const CLAUDE_USAGE_MIN_INTERVAL_MS = 60_000;

// The shape bureau needs off the SDK Query object. Declared structurally and
// OPTIONALLY rather than importing the SDK's type: the method is explicitly
// experimental, so the typeof check below must be the thing that decides
// whether it exists, not the compiler.
export interface ClaudeUsageCapableQuery {
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: () => Promise<unknown>;
}

// ISO 8601 -> epoch ms, null for anything unparseable. The SDK types resets_at
// as `string | null`, but this whole path is defensive by design.
function parseResetsAt(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

// One window entry -> our shape, or null when there's nothing to show.
// utilization is nullable in the SDK types (the window exists, the number
// isn't in yet); clamping happens here, at the boundary with the unstable
// API, so nothing downstream has to trust the range.
function claudeWindow(raw: unknown, label: string): SubscriptionUsageWindow | null {
  if (!raw || typeof raw !== "object") return null;
  const { utilization, resets_at } = raw as { utilization?: unknown; resets_at?: unknown };
  if (typeof utilization !== "number" || !Number.isFinite(utilization)) return null;
  return {
    label,
    usedPercent: Math.max(0, Math.min(100, utilization)),
    resetsAtMs: parseResetsAt(resets_at),
  };
}

// Shape the experimental /usage response into bureau's backend-agnostic form.
// Every field is validated at runtime because the source API is explicitly
// unstable.
//
// The three outcomes are distinct on purpose (see SubscriptionUsageResult):
// `rate_limits_available: false` is the AUTHORITATIVE "this account has no
// plan allowance" (API key / Bedrock / Vertex), so it clears the pill; a
// response we can't make sense of at all is "unknown" and leaves the previous
// reading alone.
export function normalizeClaudeSubscriptionUsage(raw: unknown): SubscriptionUsageResult {
  if (!raw || typeof raw !== "object") return { kind: "unknown" };
  const resp = raw as { subscription_type?: unknown; rate_limits_available?: unknown; rate_limits?: unknown };
  if (typeof resp.rate_limits_available !== "boolean") return { kind: "unknown" };
  if (!resp.rate_limits_available) return { kind: "unavailable" };
  const limits = resp.rate_limits;
  if (!limits || typeof limits !== "object") return { kind: "unavailable" };
  const byKey = limits as Record<string, unknown>;
  const windows: SubscriptionUsageWindow[] = [];
  for (const { key, label } of CLAUDE_RATE_LIMIT_WINDOWS) {
    const win = claudeWindow(byKey[key], label);
    if (win) windows.push(win);
  }
  // Per-model weekly windows the server sends as a list. Additive and
  // server-labelled ("Fable"), and they DO gate this session, so they belong
  // on screen — the pill's number comes from whichever window is closest to
  // its limit, and one of these can be it.
  if (Array.isArray(byKey.model_scoped)) {
    for (const entry of byKey.model_scoped) {
      const name = (entry as { display_name?: unknown } | null)?.display_name;
      if (typeof name !== "string" || name.length === 0) continue;
      const win = claudeWindow(entry, `Weekly (${name})`);
      if (win) windows.push(win);
    }
  }
  // The account has plan limits, but the response carried no usable number:
  // authoritative enough to clear rather than to freeze a stale figure.
  if (windows.length === 0) return { kind: "unavailable" };
  return {
    kind: "usage",
    usage: { plan: typeof resp.subscription_type === "string" ? resp.subscription_type : null, windows },
  };
}

// Throttled, single-flight reader over one conversation's experimental /usage
// call. Per conversation is the right scope: the answer describes the account,
// and every conversation on this box is asking about the same one, but a shared
// cache would need a lifetime story nobody has asked for.
//
// `getQuery` is a thunk rather than the query itself so a session can hand this
// over before its SDK query exists.
export function createClaudeSubscriptionUsageReader(getQuery: () => ClaudeUsageCapableQuery | null | undefined, nowMs: () => number = Date.now): () => Promise<SubscriptionUsageResult> {
  let last: { atMs: number; result: SubscriptionUsageResult } | null = null;
  let inFlight: Promise<SubscriptionUsageResult> | null = null;

  return async function read(): Promise<SubscriptionUsageResult> {
    const query = getQuery();
    const usage = query?.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
    // Absent method = the SDK renamed or dropped the experimental API. That
    // is authoritative in its own way: we will never learn a number here, so
    // clear the pill rather than freeze whatever it last showed.
    if (typeof usage !== "function") return { kind: "unavailable" };
    // Serve the recent answer instead of paying for a fresh RPC, and
    // single-flight concurrent callers onto one request. The interval is
    // measured INITIATION to initiation: `now` is captured before the call
    // and stamped on the result, so a slow response can't stretch the gap to
    // "RPC duration + 60s".
    const now = nowMs();
    if (last && now - last.atMs < CLAUDE_USAGE_MIN_INTERVAL_MS) return last.result;
    if (inFlight) return inFlight;
    const call: Promise<SubscriptionUsageResult> = (async () => {
      try {
        const result = normalizeClaudeSubscriptionUsage(await usage.call(query));
        last = { atMs: now, result };
        return result;
      } catch {
        // A failed call teaches us nothing — the caller keeps whatever it
        // had. Deliberately NOT cached, so the next turn boundary retries.
        return { kind: "unknown" as const };
      }
    })().finally(() => {
      if (inFlight === call) inFlight = null;
    });
    inFlight = call;
    return call;
  };
}
