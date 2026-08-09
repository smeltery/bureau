// The commit protocol behind the header's usage pill. What matters here is that
// the reading outlives conversations, that an authoritative "no allowance"
// clears it while a failed read does not, and that a slow older sample can
// never overwrite a newer one.
import { describe, expect, it } from "bun:test";

import { pickPrimaryWindow, refreshSubscriptionUsage, toSubscriptionUsageSnapshot, type SubscriptionUsageState } from "./subscription-usage.ts";
import type { SubscriptionUsageResult } from "./types.ts";

function stateWith(results: SubscriptionUsageResult[], agentType = "claude"): SubscriptionUsageState & { calls: number } {
  const state = {
    calls: 0,
    info: { agentType },
    session: {
      getSubscriptionUsage: async () => {
        const next = results[Math.min(state.calls, results.length - 1)]!;
        state.calls++;
        return next;
      },
    },
  } as SubscriptionUsageState & { calls: number };
  return state;
}

const usage = (usedPercent: number, label = "Weekly"): SubscriptionUsageResult => ({
  kind: "usage",
  usage: { plan: "max", windows: [{ label, usedPercent, resetsAtMs: null }] },
});

describe("pickPrimaryWindow", () => {
  it("follows the window closest to its limit, not the plan-shaped one", () => {
    // A weekly window at 30% would read green while a 5-hour window sits at
    // 95%, which is precisely the situation the pill exists to surface.
    const windows = [
      { label: "Weekly", usedPercent: 30, resetsAtMs: null },
      { label: "5-hour", usedPercent: 95, resetsAtMs: null },
    ];
    expect(pickPrimaryWindow(windows)).toBe(1);
  });

  it("breaks ties toward the backend's display order, so the pick is stable", () => {
    const windows = [
      { label: "Weekly", usedPercent: 50, resetsAtMs: null },
      { label: "5-hour", usedPercent: 50, resetsAtMs: null },
    ];
    expect(pickPrimaryWindow(windows)).toBe(0);
  });
});

describe("toSubscriptionUsageSnapshot", () => {
  it("clamps again at the wire boundary and stamps the sample time", () => {
    const snap = toSubscriptionUsageSnapshot({ plan: "pro", windows: [{ label: "Weekly", usedPercent: 140, resetsAtMs: 5 }] }, 1234)!;
    expect(snap).toEqual({ plan: "pro", windows: [{ label: "Weekly", usedPercent: 100, resetsAtMs: 5 }], primaryIndex: 0, sampledAtMs: 1234 });
  });

  it("has nothing to show for an empty window list", () => {
    expect(toSubscriptionUsageSnapshot({ plan: null, windows: [] }, 1)).toBeNull();
  });
});

describe("refreshSubscriptionUsage", () => {
  it("returns null with no agent and no session at all", async () => {
    expect(await refreshSubscriptionUsage(undefined)).toBeNull();
    expect(await refreshSubscriptionUsage({ info: { agentType: "claude" }, session: null })).toBeNull();
  });

  it("returns null for a backend that cannot report it", async () => {
    // Absent method, not a failed call: the pill shows its unknown state.
    expect(await refreshSubscriptionUsage({ info: { agentType: "codex" }, session: {} })).toBeNull();
  });

  it("commits a reading and picks the most constrained window", async () => {
    const state = stateWith([
      {
        kind: "usage",
        usage: {
          plan: "max",
          windows: [
            { label: "Weekly", usedPercent: 30, resetsAtMs: null },
            { label: "5-hour", usedPercent: 95, resetsAtMs: null },
          ],
        },
      },
    ]);
    const snap = (await refreshSubscriptionUsage(state, () => 999))!;
    expect(snap.primaryIndex).toBe(1);
    expect(snap.sampledAtMs).toBe(999);
    expect(state.subscriptionUsage).toBe(snap);
  });

  it("keeps the last reading when the backend learned nothing", async () => {
    const state = stateWith([usage(40), { kind: "unknown" }]);
    await refreshSubscriptionUsage(state);
    const kept = await refreshSubscriptionUsage(state);
    expect(kept?.windows[0]!.usedPercent).toBe(40);
  });

  it("clears on an AUTHORITATIVE 'no plan allowance here'", async () => {
    // API key / Bedrock / Vertex, or an account that reports no meter. The
    // answer arrived, so a stale number must not stay on screen.
    const state = stateWith([usage(40), { kind: "unavailable" }]);
    await refreshSubscriptionUsage(state);
    expect(await refreshSubscriptionUsage(state)).toBeNull();
    expect(state.subscriptionUsage).toBeNull();
  });

  it("drops the reading when the agent switches engines", async () => {
    // A different engine is a different provider account, so the previous
    // number isn't stale — it's about someone else.
    const state = stateWith([usage(40)]);
    await refreshSubscriptionUsage(state);
    state.info.agentType = "codex";
    state.session = null;
    expect(await refreshSubscriptionUsage(state)).toBeNull();
    expect(state.subscriptionUsageAccount).toBe("codex");
  });

  it("survives a conversation swap, because the quota belongs to the account", async () => {
    // /clear, fork and same-engine resume replace the session object. The
    // reading stays: it never described the conversation.
    const state = stateWith([usage(40)]);
    await refreshSubscriptionUsage(state);
    state.session = { getSubscriptionUsage: async () => ({ kind: "unknown" }) };
    expect((await refreshSubscriptionUsage(state))?.windows[0]!.usedPercent).toBe(40);
  });

  it("lets a newer sample win even when an older one resolves last", async () => {
    let releaseSlow: ((r: SubscriptionUsageResult) => void) | null = null;
    let call = 0;
    const state: SubscriptionUsageState = {
      info: { agentType: "claude" },
      session: {
        getSubscriptionUsage: () => {
          call++;
          if (call === 1) return new Promise<SubscriptionUsageResult>((resolve) => (releaseSlow = resolve));
          return Promise.resolve(usage(80));
        },
      },
    };
    const slow = refreshSubscriptionUsage(state);
    const fast = await refreshSubscriptionUsage(state);
    expect(fast?.windows[0]!.usedPercent).toBe(80);
    releaseSlow!(usage(10));
    await slow;
    // The stale answer is dropped rather than painted over the fresh one.
    expect(state.subscriptionUsage?.windows[0]!.usedPercent).toBe(80);
  });

  it("keeps the reading when the backend rejects instead of resolving", async () => {
    const state = stateWith([usage(40)]);
    await refreshSubscriptionUsage(state);
    state.session = {
      getSubscriptionUsage: () => Promise.reject(new Error("surprise")),
    };
    expect((await refreshSubscriptionUsage(state))?.windows[0]!.usedPercent).toBe(40);
  });
});
