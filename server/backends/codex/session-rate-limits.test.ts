// Codex plan-allowance tracking. Driven at the tracker seam rather than through
// a live CodexSession: bureau's session owns its JSON-RPC client, so the tracker
// is the unit that holds every decision here (bucket routing, the sparse merge
// rule, and the read that only covers the pre-push gap).
import { describe, expect, it } from "bun:test";

import { CodexRateLimitTracker, codexPlanDisplayName, codexResetsAtMs, codexWindowLabel, normalizeCodexSubscriptionUsage } from "./session-rate-limits.ts";
import type { GetAccountRateLimitsResponse } from "./_generated/v2/GetAccountRateLimitsResponse.ts";
import type { RateLimitSnapshot } from "./_generated/v2/RateLimitSnapshot.ts";

const week = { usedPercent: 34.5, windowDurationMins: 10080, resetsAt: null };
const fiveHour = { usedPercent: 80, windowDurationMins: 300, resetsAt: null };

// A full RateLimitSnapshot with the fields a test cares about overridden.
function snapshot(over: Partial<Record<string, unknown>> = {}): RateLimitSnapshot {
  return {
    limitId: "codex",
    limitName: null,
    primary: week,
    secondary: null,
    credits: null,
    individualLimit: null,
    spendControlReached: null,
    planType: "plus",
    rateLimitReachedType: null,
    ...over,
  } as RateLimitSnapshot;
}

function readResponse(over: Partial<GetAccountRateLimitsResponse> = {}): GetAccountRateLimitsResponse {
  return { rateLimits: snapshot(), rateLimitsByLimitId: null, rateLimitResetCredits: null, ...over } as GetAccountRateLimitsResponse;
}

// A tracker whose read either never runs (nothing to fetch) or returns a fixed
// response, plus a call counter so a test can prove the read was skipped.
function trackerWith(response: GetAccountRateLimitsResponse | null, error?: Error) {
  const calls = { count: 0 };
  const tracker = new CodexRateLimitTracker();
  const fetchOnce = async () => {
    calls.count++;
    if (error) throw error;
    return response;
  };
  return { tracker, fetchOnce, calls };
}

async function usageOf(tracker: CodexRateLimitTracker, fetchOnce: () => Promise<GetAccountRateLimitsResponse | null>) {
  const r = await tracker.read(fetchOnce);
  if (r.kind !== "usage") throw new Error(`expected usage, got ${r.kind}`);
  return r.usage;
}

describe("codex window labels and reset times", () => {
  it("labels windows by duration, not by which slot they arrived in", () => {
    expect(codexWindowLabel(10080)).toBe("Weekly");
    expect(codexWindowLabel(1440)).toBe("Daily");
    expect(codexWindowLabel(300)).toBe("5-hour");
    expect(codexWindowLabel(43200)).toBe("30-day");
    expect(codexWindowLabel(90)).toBe("90-minute");
    expect(codexWindowLabel(null)).toBe("Plan allowance");
  });

  it("reads resetsAt in either epoch unit", () => {
    // Codex sends seconds today, but the generated schema only promises a number.
    expect(codexResetsAtMs(1785000000)).toBe(1785000000000);
    expect(codexResetsAtMs(1785000000000)).toBe(1785000000000);
    expect(codexResetsAtMs(null)).toBeNull();
    expect(codexResetsAtMs(0)).toBeNull();
    expect(codexResetsAtMs("soon")).toBeNull();
  });
});

describe("codex plan display names", () => {
  it("maps OpenAI plan slugs to user-facing names", () => {
    expect(codexPlanDisplayName("pro")).toBe("Pro 200");
    expect(codexPlanDisplayName("prolite")).toBe("Pro 100");
    expect(codexPlanDisplayName("plus")).toBe("Plus");
  });

  it("passes unknown slugs through", () => {
    expect(codexPlanDisplayName("new-plan")).toBe("new-plan");
    expect(codexPlanDisplayName(null)).toBeNull();
  });
});

describe("normalizeCodexSubscriptionUsage", () => {
  it("normalizes a snapshot into display order, longest window first", () => {
    // primary/secondary slot meaning has moved across codex versions, so the
    // ordering is derived from the durations, never from the slot.
    expect(normalizeCodexSubscriptionUsage(snapshot({ primary: fiveHour, secondary: week }))).toEqual({
      kind: "usage",
      usage: {
        plan: "Plus",
        windows: [
          { label: "Weekly", usedPercent: 34.5, resetsAtMs: null },
          { label: "5-hour", usedPercent: 80, resetsAtMs: null },
        ],
      },
    });
  });

  it("clamps out-of-range percentages at the wire boundary", () => {
    expect(normalizeCodexSubscriptionUsage(snapshot({ primary: { ...week, usedPercent: 130 }, secondary: { ...fiveHour, usedPercent: -4 } }))).toEqual({
      kind: "usage",
      usage: {
        plan: "Plus",
        windows: [
          { label: "Weekly", usedPercent: 100, resetsAtMs: null },
          { label: "5-hour", usedPercent: 0, resetsAtMs: null },
        ],
      },
    });
  });

  it("separates 'nothing to report' from 'nothing asked yet'", () => {
    // A snapshot with no usable window is an answer: clear the pill.
    expect(normalizeCodexSubscriptionUsage(snapshot({ primary: null, secondary: null }))).toEqual({ kind: "unavailable" });
    // No snapshot at all is not an answer.
    expect(normalizeCodexSubscriptionUsage(null)).toEqual({ kind: "unknown" });
  });
});

describe("CodexRateLimitTracker", () => {
  it("serves pushed rate limits without issuing a read request", async () => {
    const { tracker, fetchOnce, calls } = trackerWith(readResponse());
    tracker.applyUpdate(snapshot());
    const usage = await usageOf(tracker, fetchOnce);
    expect(usage.plan).toBe("Plus");
    expect(usage.windows[0]).toEqual({ label: "Weekly", usedPercent: 34.5, resetsAtMs: null });
    expect(calls.count).toBe(0);
  });

  it("merges sparse updates instead of letting a null clear a known value", async () => {
    const { tracker, fetchOnce } = trackerWith(null);
    tracker.applyUpdate(snapshot({ secondary: fiveHour }));
    // A rolling update carrying only a fresher weekly number: the plan and the
    // 5-hour window are "not included", NOT "gone".
    tracker.applyUpdate(snapshot({ limitId: "codex", primary: { ...week, usedPercent: 41 }, secondary: null, planType: null }));
    const usage = await usageOf(tracker, fetchOnce);
    expect(usage.plan).toBe("Plus");
    expect(usage.windows.map((w) => w.usedPercent)).toEqual([41, 80]);
  });

  it("merges window FIELDS, so a percentage-only update keeps duration and reset", async () => {
    // The sparse rule is recursive. Replacing the whole window on every push
    // would drop windowDurationMins — and with it the label, which is derived
    // from the duration — the first time codex sent a bare percentage.
    const { tracker, fetchOnce } = trackerWith(null);
    tracker.applyUpdate(snapshot({ primary: { usedPercent: 34.5, windowDurationMins: 10080, resetsAt: 1785000000 } }));
    tracker.applyUpdate(snapshot({ primary: { usedPercent: 41, windowDurationMins: null, resetsAt: null } }));
    const usage = await usageOf(tracker, fetchOnce);
    expect(usage.windows[0]).toEqual({ label: "Weekly", usedPercent: 41, resetsAtMs: 1785000000000 });
  });

  it("keeps separate metered buckets apart and prefers the codex one", async () => {
    // A business account can meter more than one thing; blending two meters
    // would invent a number that describes neither.
    const { tracker, fetchOnce } = trackerWith(null);
    tracker.applyUpdate(snapshot({ limitId: "some-other-meter", primary: { ...week, usedPercent: 3 }, planType: "business" }));
    tracker.applyUpdate(snapshot({ limitId: "codex", planType: "business" }));
    expect((await usageOf(tracker, fetchOnce)).windows[0]!.usedPercent).toBe(34.5);
  });

  it("falls back to one read before anything was pushed, then serves the cache", async () => {
    const { tracker, fetchOnce, calls } = trackerWith(readResponse({ rateLimits: snapshot({ limitId: null, planType: "pro" }) }));
    expect((await usageOf(tracker, fetchOnce)).plan).toBe("Pro 200");
    await tracker.read(fetchOnce);
    expect(calls.count).toBe(1);
  });

  it("ingests the keyed buckets from a read, not just the legacy view", async () => {
    const { tracker, fetchOnce } = trackerWith(
      readResponse({
        // Historical single-bucket view describes a different meter here.
        rateLimits: snapshot({ limitId: "legacy-meter", primary: { ...week, usedPercent: 2 } }),
        rateLimitsByLimitId: { codex: snapshot({ primary: { ...week, usedPercent: 77 } }) },
      }),
    );
    expect((await usageOf(tracker, fetchOnce)).windows[0]!.usedPercent).toBe(77);
  });

  it("lets a notification that lands mid-read win over the read's baseline", async () => {
    const tracker = new CodexRateLimitTracker();
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchOnce = async () => {
      await gate;
      return readResponse({ rateLimits: snapshot({ primary: { ...week, usedPercent: 10 } }) });
    };
    const pending = tracker.read(fetchOnce);
    // Fresher data arrives while the read is still in flight.
    tracker.applyUpdate(snapshot({ primary: { ...week, usedPercent: 55 } }));
    release!();
    expect((await pending).kind).toBe("usage");
    expect((await usageOf(tracker, fetchOnce)).windows[0]!.usedPercent).toBe(55);
  });

  it("lets a late read fill metadata a sparse push left null, without undoing it", async () => {
    // Sparse-first ordering: a percentage-only notification creates the bucket
    // while the read is still out. Skipping the read wholesale for an existing
    // key would mean the window's duration — and so its label and reset time —
    // never arrived.
    const tracker = new CodexRateLimitTracker();
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchOnce = async () => {
      await gate;
      return readResponse({ rateLimits: snapshot({ primary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: 1785000000 } }) });
    };
    const pending = tracker.read(fetchOnce);
    tracker.applyUpdate(snapshot({ planType: null, primary: { usedPercent: 55, windowDurationMins: null, resetsAt: null } }));
    release!();
    await pending;
    const usage = await usageOf(tracker, fetchOnce);
    // Fresher number from the push, metadata from the older read.
    expect(usage.windows[0]).toEqual({ label: "Weekly", usedPercent: 55, resetsAtMs: 1785000000000 });
    // Plan came from the baseline too — the push left it null.
    expect(usage.plan).toBe("Plus");
  });

  it("files a keyed read entry under its MAP key, not its nullable limitId", async () => {
    // The response map key is the authoritative metered id; limitId inside the
    // snapshot is nullable metadata. Filing by the latter would drop a
    // { codex: {limitId: null} } entry into the legacy bucket, where it can
    // lose selection to an unrelated meter.
    const { tracker, fetchOnce } = trackerWith(
      readResponse({
        rateLimits: snapshot({ limitId: null, primary: { ...week, usedPercent: 4 } }),
        rateLimitsByLimitId: { codex: snapshot({ limitId: null, primary: { ...week, usedPercent: 66 } }) },
      }),
    );
    expect((await usageOf(tracker, fetchOnce)).windows[0]!.usedPercent).toBe(66);
  });

  it("routes an id-less rolling update to the one bucket it can only mean", async () => {
    // Rolling updates may omit limitId entirely. With a single known meter
    // that is unambiguous, and filing it as a separate legacy bucket would
    // strand the fresher number where nothing displays it.
    const { tracker, fetchOnce } = trackerWith(null);
    tracker.applyUpdate(snapshot({ limitId: "codex", primary: { usedPercent: 20, windowDurationMins: 10080, resetsAt: 1785000000 } }));
    tracker.applyUpdate(snapshot({ limitId: null, planType: null, primary: { usedPercent: 47, windowDurationMins: null, resetsAt: null } }));
    const usage = await usageOf(tracker, fetchOnce);
    expect(usage.plan).toBe("Plus");
    expect(usage.windows[0]).toEqual({ label: "Weekly", usedPercent: 47, resetsAtMs: 1785000000000 });
  });

  it("drops an id-less update when several meters make it ambiguous", async () => {
    // Misfiling would show one meter's number under another meter's name; the
    // next keyed push or read re-syncs, so dropping is the safe answer.
    const { tracker, fetchOnce } = trackerWith(null);
    tracker.applyUpdate(snapshot({ limitId: "codex" }));
    tracker.applyUpdate(snapshot({ limitId: "other-meter", primary: { ...week, usedPercent: 9 } }));
    tracker.applyUpdate(snapshot({ limitId: null, primary: { ...week, usedPercent: 99 } }));
    // codex bucket still reads its own last known value.
    expect((await usageOf(tracker, fetchOnce)).windows[0]!.usedPercent).toBe(34.5);
  });

  it("reports 'unknown', not a clear, when the read fails", async () => {
    // An unreachable or unauthenticated read teaches us nothing, so a pill
    // populated from an earlier reading must survive it.
    const { tracker, fetchOnce } = trackerWith(null, new Error("not signed in"));
    expect(await tracker.read(fetchOnce)).toEqual({ kind: "unknown" });
  });

  it("reports 'unknown' when the session cannot even issue the read", async () => {
    // Bootstrap failed or the session is closed: nothing was asked.
    const { tracker, fetchOnce } = trackerWith(null);
    expect(await tracker.read(fetchOnce)).toEqual({ kind: "unknown" });
  });

  it("reports 'unavailable' when a successful read has no rate limits at all", async () => {
    const { tracker, fetchOnce } = trackerWith(readResponse({ rateLimits: null as unknown as RateLimitSnapshot }));
    expect(await tracker.read(fetchOnce)).toEqual({ kind: "unavailable" });
  });
});
