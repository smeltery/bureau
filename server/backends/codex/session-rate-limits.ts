// Codex plan-allowance reading: the data behind the header's usage pill.
//
// Codex PUSHES rate limits (`account/rateLimits/updated`), so the common path
// is a pure cache read — no throttling needed and none applied. The
// `account/rateLimits/read` request only covers the gap before the first
// notification arrives (a freshly spawned agent that hasn't run a turn yet);
// the generated docs point at exactly that sequencing, rolling updates being
// meant to merge into the most recent `account/rateLimits/read` response.

import type { SubscriptionUsageResult, SubscriptionUsageWindow } from "../types.ts";
import type { GetAccountRateLimitsResponse } from "./_generated/v2/GetAccountRateLimitsResponse.ts";
import type { RateLimitSnapshot } from "./_generated/v2/RateLimitSnapshot.ts";
import type { RateLimitWindow } from "./_generated/v2/RateLimitWindow.ts";
import type { PlanType } from "./_generated/PlanType.ts";

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 60 * 24;
const MINUTES_PER_WEEK = MINUTES_PER_DAY * 7;

// Human label for a rate-limit window, derived from its duration. Codex names
// its windows "primary"/"secondary", and which of the two is the weekly one
// has moved across codex versions — the duration is the stable fact, so the
// label (and the pick of which window the pill shows) comes from it.
export function codexWindowLabel(minutes: number | null): string {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return "Plan allowance";
  if (minutes === MINUTES_PER_WEEK) return "Weekly";
  if (minutes === MINUTES_PER_DAY) return "Daily";
  if (minutes % MINUTES_PER_DAY === 0) return `${minutes / MINUTES_PER_DAY}-day`;
  if (minutes % MINUTES_PER_HOUR === 0) return `${minutes / MINUTES_PER_HOUR}-hour`;
  return `${minutes}-minute`;
}

// Codex reports `resetsAt` as a bare epoch number — SECONDS in the payloads
// seen so far. The generated schema only says "number", so rather than
// hard-code the unit we pick it by magnitude: any epoch-seconds value this
// century is < 1e11, any epoch-ms value from 1973 on is >= 1e11. Wrong only
// for dates outside roughly 1970-5138, which no reset window is.
const EPOCH_MS_THRESHOLD = 1e11;

export function codexResetsAtMs(resetsAt: unknown): number | null {
  if (typeof resetsAt !== "number" || !Number.isFinite(resetsAt)) return null;
  if (resetsAt <= 0) return null;
  return resetsAt >= EPOCH_MS_THRESHOLD ? resetsAt : resetsAt * 1000;
}

// Which metered bucket bureau displays when the account has several. Codex's
// own metered limit for agent turns is keyed "codex"; a business account can
// carry other meters that say nothing about this agent's turns.
export const CODEX_PREFERRED_LIMIT_ID = "codex";

// Key used for the historical single-bucket view (GetAccountRateLimitsResponse
// .rateLimits, and any notification whose snapshot has no limitId). Kept
// separate from the keyed buckets so the two never merge into each other.
export const CODEX_LEGACY_LIMIT_KEY = "";

// Wire plan slugs -> the labels Codex itself shows in /status (codex-rs
// tui/src/subscription.rs at rust-v0.160.0). Typed over the whole PlanType
// union, so a schema regen that adds a plan fails typecheck until it has a
// label. A slug outside the union passes through verbatim.
const CODEX_PLAN_DISPLAY_NAMES: Record<PlanType, string> = {
  free: "Free",
  go: "Go",
  plus: "Plus",
  pro: "Pro 200",
  prolite: "Pro 100",
  promax: "Pro 500",
  team: "Business",
  self_serve_business_usage_based: "Business",
  business: "Enterprise",
  self_serve_business_prolite: "Business Premium",
  enterprise_cbp_automation: "Enterprise (Automation)",
  enterprise_cbp_usage_based: "Enterprise",
  enterprise: "Enterprise",
  ent26: "Enterprise",
  edu: "Edu",
  edu_plus: "Edu Plus",
  edu_pro: "Edu Pro",
  unknown: "Unknown",
};

export function codexPlanDisplayName(planType: string | null): string | null {
  return planType ? ((CODEX_PLAN_DISPLAY_NAMES as Record<string, string>)[planType] ?? planType) : null;
}

export function codexLimitKey(snapshot: RateLimitSnapshot): string {
  return snapshot.limitId ?? CODEX_LEGACY_LIMIT_KEY;
}

// Which cached bucket an ID-LESS rolling update belongs to. limitId is
// nullable metadata, and the generated docs warn that nullable metadata may
// simply be absent from a rolling update — so an id-less push is usually a
// fresher number for a bucket we already know, not news about a new meter.
//   - nothing cached yet: start the legacy bucket (nothing to be ambiguous
//     with, and it's the historical single-bucket shape).
//   - exactly one bucket cached: unambiguous, it's that one.
//   - several buckets cached: genuinely ambiguous. Return null and DROP the
//     update rather than guess — a wrong guess would show one meter's number
//     under another meter's name, and the next keyed push or read re-syncs.
export function resolveCodexUpdateKey(buckets: Map<string, RateLimitSnapshot>, update: RateLimitSnapshot): string | null {
  if (update.limitId !== null) return update.limitId;
  if (buckets.size === 0) return CODEX_LEGACY_LIMIT_KEY;
  if (buckets.size === 1) return buckets.keys().next().value ?? null;
  return null;
}

// Pick the bucket the pill describes: the codex meter when the account has
// one, otherwise the historical view, otherwise whatever single bucket exists.
export function pickCodexLimitBucket(buckets: Map<string, RateLimitSnapshot>): RateLimitSnapshot | null {
  return buckets.get(CODEX_PREFERRED_LIMIT_ID) ?? buckets.get(CODEX_LEGACY_LIMIT_KEY) ?? buckets.values().next().value ?? null;
}

// Merge one rolling window update into what we already knew about that slot.
// The sparse rule is RECURSIVE: an update can carry a fresh usedPercent while
// leaving windowDurationMins / resetsAt null, and treating the whole window as
// replaced would throw away the duration the label is derived from — the
// window would silently become "Plan allowance" with no reset time the first
// time a percentage-only update arrived. usedPercent is the live value and is
// always taken from the update; the nullable metadata falls back.
export function mergeRateLimitWindow(prev: RateLimitWindow | null, next: RateLimitWindow | null): RateLimitWindow | null {
  if (!next) return prev;
  if (!prev) return next;
  return {
    usedPercent: next.usedPercent,
    windowDurationMins: next.windowDurationMins ?? prev.windowDurationMins,
    resetsAt: next.resetsAt ?? prev.resetsAt,
  };
}

// Merge two snapshots of the SAME metered bucket. `newer` wins wherever it
// carries a value; every nullable field falls back to `older`. Used in both
// directions: a rolling update merged onto the cache (cache is older), and a
// late `account/rateLimits/read` merged UNDER a notification that overtook it
// (the read is older).
export function mergeRateLimitSnapshots(older: RateLimitSnapshot, newer: RateLimitSnapshot): RateLimitSnapshot {
  return {
    limitId: newer.limitId ?? older.limitId,
    limitName: newer.limitName ?? older.limitName,
    normalModelSlug: newer.normalModelSlug ?? older.normalModelSlug,
    // A null window is "not in this update", not "this window is gone". An
    // account that genuinely loses a window reports it via a fresh read (or a
    // new limitId), not by omitting it from a rolling update.
    primary: mergeRateLimitWindow(older.primary, newer.primary),
    secondary: mergeRateLimitWindow(older.secondary, newer.secondary),
    credits: newer.credits ?? older.credits,
    individualLimit: newer.individualLimit ?? older.individualLimit,
    spendControlReached: newer.spendControlReached ?? older.spendControlReached,
    planType: newer.planType ?? older.planType,
    rateLimitReachedType: newer.rateLimitReachedType ?? older.rateLimitReachedType,
  };
}

// RateLimitSnapshot -> bureau's backend-agnostic reading. Windows come back in
// DISPLAY order, longest first (the plan-shaped one leads); which of them the
// pill's number comes from is the wire layer's call, not this function's.
// Clamping happens here, at the wire boundary. "unavailable" means the
// app-server answered with a snapshot that has no usable window —
// authoritative enough to clear the pill.
export function normalizeCodexSubscriptionUsage(snapshot: RateLimitSnapshot | null | undefined): SubscriptionUsageResult {
  if (!snapshot) return { kind: "unknown" };
  const scored: { window: SubscriptionUsageWindow; minutes: number }[] = [];
  for (const win of [snapshot.primary, snapshot.secondary]) {
    const w = win as RateLimitWindow | null | undefined;
    if (!w) continue;
    if (typeof w.usedPercent !== "number" || !Number.isFinite(w.usedPercent)) continue;
    const minutes = typeof w.windowDurationMins === "number" && Number.isFinite(w.windowDurationMins) ? w.windowDurationMins : 0;
    scored.push({
      window: {
        label: codexWindowLabel(minutes || null),
        usedPercent: Math.max(0, Math.min(100, w.usedPercent)),
        resetsAtMs: codexResetsAtMs(w.resetsAt),
      },
      minutes,
    });
  }
  if (scored.length === 0) return { kind: "unavailable" };
  // Longest first; Array.prototype.sort is stable, so equal durations keep
  // primary-before-secondary order.
  scored.sort((a, b) => b.minutes - a.minutes);
  return {
    kind: "usage",
    usage: { plan: codexPlanDisplayName(snapshot.planType), windows: scored.map((s) => s.window) },
  };
}

// Latest known subscription rate limits for the signed-in ChatGPT account,
// keyed by metered limitId (see codexLimitKey). Fed by
// `account/rateLimits/updated` notifications and, until one arrives, a single
// `account/rateLimits/read`. Describes the ACCOUNT, not one thread, so every
// agent on the same CODEX_HOME sees the same figures. Buckets are kept apart
// rather than flattened: an account can meter more than one thing, and blending
// two meters would invent a number.
export class CodexRateLimitTracker {
  private buckets = new Map<string, RateLimitSnapshot>();
  private readInFlight: Promise<void> | null = null;
  // Set once a read has come back successfully. Distinguishes "no rate-limit
  // data because nothing has been asked or pushed yet" (unknown) from "asked,
  // and this account reports none" (authoritative).
  private readSettled = false;

  // Merge a sparse rolling update into the matching bucket. A null field in an
  // update means "not included this time" and must NOT clear a value already
  // observed (see AccountRateLimitsUpdatedNotification's doc comment). Fields
  // are merged one by one rather than object-spread so a schema addition can't
  // silently ride in as an unmerged wholesale replacement.
  applyUpdate(next: RateLimitSnapshot): void {
    const key = resolveCodexUpdateKey(this.buckets, next);
    // Ambiguous id-less update against several meters — see
    // resolveCodexUpdateKey. Dropping beats misfiling.
    if (key === null) return;
    const prev = this.buckets.get(key);
    this.buckets.set(key, prev ? mergeRateLimitSnapshots(prev, next) : next);
  }

  async read(fetchOnce: () => Promise<GetAccountRateLimitsResponse | null>): Promise<SubscriptionUsageResult> {
    if (this.buckets.size === 0) await this.readOnce(fetchOnce);
    const bucket = pickCodexLimitBucket(this.buckets);
    if (bucket) return normalizeCodexSubscriptionUsage(bucket);
    // No data. Only authoritative once a read actually came back: before that
    // we simply haven't asked yet, and clearing would blank a live pill on
    // every session replacement.
    return this.readSettled ? { kind: "unavailable" } : { kind: "unknown" };
  }

  // Fold a `account/rateLimits/read` response in as an OLDER baseline. It was
  // issued before anything that arrived while it was in flight, so a
  // notification that overtook it keeps its fresher numbers — but the baseline
  // still fills whatever that notification left null. Dropping it wholesale
  // would mean a sparse percentage-only push followed by a full read never
  // recovered the window's duration, and therefore its label and reset time.
  //
  // The response map's key is the AUTHORITATIVE metered limit id; the
  // snapshot's own limitId is nullable metadata that may be absent even when
  // the entry is keyed. Callers pass the map key when they have one, so a
  // `{ codex: {limitId: null, ...} }` entry files under "codex" and not under
  // the legacy bucket, where it could lose selection.
  private applyBaseline(baseline: RateLimitSnapshot, keyOverride?: string): void {
    const key = keyOverride ?? codexLimitKey(baseline);
    const newer = this.buckets.get(key);
    this.buckets.set(key, newer ? mergeRateLimitSnapshots(baseline, newer) : baseline);
  }

  // `account/rateLimits/read`, deduped so concurrent refreshes share one
  // request. Failures are swallowed — the caller reports "unknown" and keeps
  // whatever it had. Deliberately re-attemptable on a later call, so a user
  // who signs in mid-session starts seeing the pill without a restart.
  private readOnce(fetchOnce: () => Promise<GetAccountRateLimitsResponse | null>): Promise<void> {
    if (this.readInFlight) return this.readInFlight;
    const inFlight: Promise<void> = (async () => {
      try {
        const resp = await fetchOnce();
        if (!resp) return;
        this.readSettled = true;
        // Everything here is an OLDER baseline than anything pushed while the
        // request was in flight — see applyBaseline. The historical
        // single-bucket view has no map key of its own, so it files under its
        // own limitId (or the legacy key); the keyed entries file under their
        // MAP key, which is the authoritative metered id.
        if (resp.rateLimits) this.applyBaseline(resp.rateLimits);
        for (const [limitId, snap] of Object.entries(resp.rateLimitsByLimitId ?? {})) {
          if (snap) this.applyBaseline(snap, limitId);
        }
      } catch {
        // Unauthenticated, API-key-only, or an app-server that doesn't know
        // the method. Not settled: we learned nothing, so the pill keeps
        // whatever it was showing instead of being cleared.
      }
    })().finally(() => {
      if (this.readInFlight === inFlight) this.readInFlight = null;
    });
    this.readInFlight = inFlight;
    return inFlight;
  }
}
