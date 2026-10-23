import { expect, test } from "bun:test";
import { CodexQuotaStop, quotaResetAt } from "./quota-stop.ts";
import type { RateLimitSnapshot } from "../_generated/v2/RateLimitSnapshot.ts";
import type { NormalizedEvent } from "../../types.ts";

const future = Math.floor(Date.now() / 1000) + 3600;
function snapshot(overrides = {}): RateLimitSnapshot {
  return { primary: { usedPercent: 100, resetsAt: future }, secondary: null, rateLimitReachedType: null, spendControlReached: null, ...overrides } as RateLimitSnapshot;
}

test("quota reset waits for every blocking window and excludes spend controls", () => {
  expect(quotaResetAt(snapshot())).toBe(future * 1000);
  expect(quotaResetAt(snapshot({ secondary: { usedPercent: 100, resetsAt: future + 500 } }))).toBe((future + 500) * 1000);
  expect(quotaResetAt(snapshot({ secondary: { usedPercent: 100, resetsAt: null } }))).toBeUndefined();
  expect(quotaResetAt(snapshot({ spendControlReached: true }))).toBeUndefined();
  expect(quotaResetAt(snapshot({ rateLimitReachedType: "credits_exhausted" }))).toBeUndefined();
  expect(quotaResetAt(snapshot({ primary: { usedPercent: 80, resetsAt: future } }))).toBeUndefined();
  expect(quotaResetAt(snapshot({ primary: { usedPercent: 99, resetsAt: future }, rateLimitReachedType: "rate_limit_reached" }))).toBe(future * 1000);
});

function world() {
  const events: NormalizedEvent[] = [];
  let reset: number | undefined;
  let release!: () => void;
  let timeout!: () => void;
  let refreshes = 0;
  const tracker = new CodexQuotaStop(
    () => reset,
    () => {
      refreshes++;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    (event) => events.push(event),
    (run) => {
      timeout = run;
      return () => {};
    },
  );
  return {
    tracker,
    events,
    setReset: (value: number) => {
      reset = value;
    },
    release: () => release(),
    timeout: () => timeout(),
    refreshes: () => refreshes,
  };
}
const failed = { kind: "turn_completed", status: "failed" } as const;

test("only a structured quota stop attaches a reset to a failed turn", () => {
  const w = world();
  w.setReset(future * 1000);
  w.tracker.complete(failed, "rateLimitExceeded");
  expect(w.events).toEqual([failed]);
  w.tracker.note("usageLimitExceeded");
  w.tracker.complete(failed, undefined);
  expect(w.events[1]).toEqual({ ...failed, usageLimitResetAt: future * 1000 });
  w.tracker.complete(failed, undefined);
  expect(w.events[2]).toEqual(failed);
  expect(w.refreshes()).toBe(0);
});

test("a missing or stale reset refreshes with a bounded wait", async () => {
  const w = world();
  w.setReset(1);
  w.tracker.complete(failed, "usageLimitExceeded");
  expect(w.events).toEqual([]);
  w.setReset(future * 1000);
  w.release();
  await Promise.resolve();
  expect(w.events).toEqual([{ ...failed, usageLimitResetAt: future * 1000 }]);
  w.timeout();
  expect(w.events).toHaveLength(1);
  const stalled = world();
  stalled.tracker.complete(failed, "usageLimitExceeded");
  stalled.timeout();
  expect(stalled.events).toEqual([failed]);
  stalled.setReset(future * 1000);
  stalled.release();
  await Promise.resolve();
  expect(stalled.events).toHaveLength(1);
});

test("abort or session replacement prevents late quota data from restarting a turn", async () => {
  const w = world();
  w.tracker.complete(failed, "usageLimitExceeded");
  w.tracker.cancel();
  w.setReset(future * 1000);
  w.release();
  await Promise.resolve();
  w.timeout();
  expect(w.events).toEqual([{ ...failed, status: "interrupted" }]);
  expect(w.tracker.waiting).toBe(false);
});
