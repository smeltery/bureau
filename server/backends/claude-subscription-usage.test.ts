// The subscription pill rides an SDK method whose own name says it may change
// or vanish without notice, so this module's job is to make every failure mode
// look like a tri-state answer the UI can survive.
import { describe, expect, it } from "bun:test";
import { CLAUDE_USAGE_MIN_INTERVAL_MS, createClaudeSubscriptionUsageReader, normalizeClaudeSubscriptionUsage, type ClaudeUsageCapableQuery } from "./claude-subscription-usage.ts";

// Minimal Query stand-in: records calls and can be told to reject, to delay, or
// to lose the experimental method entirely (standing in for an SDK release that
// renames or drops it).
class FakeQuery implements ClaudeUsageCapableQuery {
  usageResult: unknown = null;
  usageError: Error | null = null;
  usageCalls = 0;
  usageDelayMs = 0;

  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: () => Promise<unknown> = async () => {
    this.usageCalls++;
    if (this.usageDelayMs > 0) await new Promise((r) => setTimeout(r, this.usageDelayMs));
    if (this.usageError) throw this.usageError;
    return this.usageResult;
  };
}

describe("createClaudeSubscriptionUsageReader", () => {
  it("reports 'unavailable' when the SDK has no such method", async () => {
    // The pill can never learn a number from this SDK, so clearing beats
    // freezing whatever it last showed.
    const q = new FakeQuery();
    q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET = undefined;
    const read = createClaudeSubscriptionUsageReader(() => q);
    expect(await read()).toEqual({ kind: "unavailable" });
  });

  it("reports 'unavailable' before the session's query exists", async () => {
    const read = createClaudeSubscriptionUsageReader(() => null);
    expect(await read()).toEqual({ kind: "unavailable" });
  });

  it("reports 'unknown' when the SDK method rejects", async () => {
    // A transient failure must not blank a valid reading.
    const q = new FakeQuery();
    q.usageError = new Error("boom");
    const read = createClaudeSubscriptionUsageReader(() => q);
    expect(await read()).toEqual({ kind: "unknown" });
  });

  it("serves a cached answer inside the throttle window", async () => {
    // The pill asks at every turn boundary; only the first ask within a minute
    // may reach the CLI.
    const q = new FakeQuery();
    q.usageResult = { subscription_type: "max", rate_limits_available: true, rate_limits: { seven_day: { utilization: 10, resets_at: null } } };
    let now = 1_000_000;
    const read = createClaudeSubscriptionUsageReader(
      () => q,
      () => now,
    );
    await read();
    q.usageResult = { subscription_type: "max", rate_limits_available: true, rate_limits: { seven_day: { utilization: 99, resets_at: null } } };
    now += CLAUDE_USAGE_MIN_INTERVAL_MS - 1;
    const second = await read();
    expect(q.usageCalls).toBe(1);
    expect(second).toEqual({ kind: "usage", usage: { plan: "max", windows: [{ label: "Weekly", usedPercent: 10, resetsAtMs: null }] } });
  });

  it("goes back to the CLI once the throttle window has elapsed", async () => {
    const q = new FakeQuery();
    q.usageResult = { subscription_type: "max", rate_limits_available: true, rate_limits: { seven_day: { utilization: 10, resets_at: null } } };
    let now = 1_000_000;
    const read = createClaudeSubscriptionUsageReader(
      () => q,
      () => now,
    );
    await read();
    now += CLAUDE_USAGE_MIN_INTERVAL_MS;
    await read();
    expect(q.usageCalls).toBe(2);
  });

  it("single-flights concurrent callers onto one RPC", async () => {
    const q = new FakeQuery();
    q.usageDelayMs = 20;
    q.usageResult = { subscription_type: "pro", rate_limits_available: true, rate_limits: { seven_day: { utilization: 5, resets_at: null } } };
    const read = createClaudeSubscriptionUsageReader(() => q);
    const [a, b] = await Promise.all([read(), read()]);
    expect(q.usageCalls).toBe(1);
    expect(a).toEqual(b);
  });

  it("does not cache a failure — the next turn boundary retries", async () => {
    const q = new FakeQuery();
    q.usageError = new Error("transient");
    const read = createClaudeSubscriptionUsageReader(() => q);
    expect(await read()).toEqual({ kind: "unknown" });
    q.usageError = null;
    q.usageResult = { subscription_type: "max", rate_limits_available: true, rate_limits: { seven_day: { utilization: 8, resets_at: null } } };
    expect(await read()).toEqual({ kind: "usage", usage: { plan: "max", windows: [{ label: "Weekly", usedPercent: 8, resetsAtMs: null }] } });
    expect(q.usageCalls).toBe(2);
  });

  it("normalizes a live-looking /usage response", async () => {
    const q = new FakeQuery();
    q.usageResult = {
      subscription_type: "max",
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 12, resets_at: "2026-07-31T20:00:00Z" },
        seven_day: { utilization: 34.5, resets_at: "2026-08-03T09:00:00Z" },
      },
    };
    const read = createClaudeSubscriptionUsageReader(() => q);
    expect(await read()).toEqual({
      kind: "usage",
      usage: {
        plan: "max",
        windows: [
          { label: "Weekly", usedPercent: 34.5, resetsAtMs: Date.parse("2026-08-03T09:00:00Z") },
          { label: "5-hour", usedPercent: 12, resetsAtMs: Date.parse("2026-07-31T20:00:00Z") },
        ],
      },
    });
  });
});

describe("normalizeClaudeSubscriptionUsage", () => {
  function usageOf(raw: unknown) {
    const r = normalizeClaudeSubscriptionUsage(raw);
    if (r.kind !== "usage") throw new Error(`expected usage, got ${r.kind}`);
    return r.usage;
  }

  it("is AUTHORITATIVELY unavailable when plan limits do not apply", () => {
    // API key / Bedrock / Vertex. The answer arrived and says there is no
    // allowance, so the pill should clear, not keep a stale number.
    expect(normalizeClaudeSubscriptionUsage({ subscription_type: null, rate_limits_available: false, rate_limits: null })).toEqual({ kind: "unavailable" });
    // Subscriber whose response carried no usable number: same call.
    expect(normalizeClaudeSubscriptionUsage({ rate_limits_available: true, rate_limits: {} })).toEqual({ kind: "unavailable" });
    expect(normalizeClaudeSubscriptionUsage({ rate_limits_available: true, rate_limits: { seven_day: { utilization: null, resets_at: null } } })).toEqual({ kind: "unavailable" });
  });

  it("is 'unknown' for a response it cannot read at all", () => {
    // Nothing was learned — whatever the pill shows stays.
    expect(normalizeClaudeSubscriptionUsage(null)).toEqual({ kind: "unknown" });
    expect(normalizeClaudeSubscriptionUsage("nope")).toEqual({ kind: "unknown" });
    expect(normalizeClaudeSubscriptionUsage({})).toEqual({ kind: "unknown" });
  });

  it("orders windows weekly-first and keeps the raw float", () => {
    const out = usageOf({
      subscription_type: "pro",
      rate_limits_available: true,
      rate_limits: {
        five_hour: { utilization: 80, resets_at: null },
        seven_day: { utilization: 9.75, resets_at: null },
        seven_day_opus: { utilization: 51, resets_at: null },
      },
    });
    expect(out.plan).toBe("pro");
    expect(out.windows.map((w) => w.label)).toEqual(["Weekly", "5-hour", "Weekly (Opus)"]);
    expect(out.windows[0]!.usedPercent).toBe(9.75);
  });

  it("includes the server's per-model weekly windows, which also gate a session", () => {
    const out = usageOf({
      rate_limits_available: true,
      rate_limits: {
        seven_day: { utilization: 20, resets_at: null },
        model_scoped: [
          { display_name: "Fable", utilization: 88, resets_at: null },
          { display_name: "", utilization: 5, resets_at: null },
          { utilization: 5, resets_at: null },
        ],
      },
    });
    expect(out.windows.map((w) => w.label)).toEqual(["Weekly", "Weekly (Fable)"]);
  });

  it("ignores seven_day_oauth_apps, which meters a different surface", () => {
    // The SDK's live gating signal (SDKRateLimitInfo.rateLimitType) never
    // names it, so it can't explain anything an agent runs into here.
    const out = usageOf({
      rate_limits_available: true,
      rate_limits: { seven_day: { utilization: 20, resets_at: null }, seven_day_oauth_apps: { utilization: 99, resets_at: null } },
    });
    expect(out.windows.map((w) => w.label)).toEqual(["Weekly"]);
  });

  it("clamps out-of-range utilization and drops unparseable reset times", () => {
    const out = usageOf({
      rate_limits_available: true,
      rate_limits: { seven_day: { utilization: 140, resets_at: "junk" }, five_hour: { utilization: -3, resets_at: 12345 } },
    });
    expect(out.windows).toEqual([
      { label: "Weekly", usedPercent: 100, resetsAtMs: null },
      { label: "5-hour", usedPercent: 0, resetsAtMs: null },
    ]);
  });

  it("keeps whatever windows are reported when seven_day is absent", () => {
    const out = usageOf({ rate_limits_available: true, rate_limits: { five_hour: { utilization: 40, resets_at: null } } });
    expect(out.plan).toBeNull();
    expect(out.windows).toEqual([{ label: "5-hour", usedPercent: 40, resetsAtMs: null }]);
  });
});
