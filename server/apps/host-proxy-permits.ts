// The relay's concurrency accounting: one permit per in-flight relayed request,
// counted per app and in total.
//
// Its own module because the counters are PROCESS-WIDE mutable state — the one
// thing in the relay that outlives a single request — and a bucket that leaks is
// a slow-motion outage rather than a visible failure. Keeping it here means
// exactly one place can move a counter, and the test seams that read it sit next
// to the code that writes it.

import type { AppRecord } from "../../shared/apps.ts";

// Keyed by the app's ISSUANCE — label plus generation — and never by its name. A
// name is reusable: an app can be deleted and re-registered while one of its
// responses is still unwinding, and a release from the dead app must not
// decrement the live one's bucket. A label is issued once, forever.
function permitKey(app: AppRecord): string {
  return `${app.hostLabel}#${app.hostGen}`;
}

const perApp = new Map<string, number>();
let totalInFlight = 0;

export interface Permit {
  release(): void;
}

// Both counters move in ONE synchronous turn, and neither moves until BOTH
// limits have said yes — so there is no half-taken permit to roll back, and no
// leaked count when the two disagree.
export function acquireRelayPermit(app: AppRecord, limits: { perApp: number; total: number }): Permit | null {
  const key = permitKey(app);
  const forApp = perApp.get(key) ?? 0;
  if (forApp >= limits.perApp) return null;
  if (totalInFlight >= limits.total) return null;
  perApp.set(key, forApp + 1);
  totalInFlight++;
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      totalInFlight--;
      const left = (perApp.get(key) ?? 1) - 1;
      // Buckets are deleted at zero: a map that only ever grows is a leak with
      // a slow fuse, and app labels are issued forever.
      if (left <= 0) perApp.delete(key);
      else perApp.set(key, left);
    },
  };
}

export function _testRelayInFlight(): { total: number; perApp: number } {
  let max = 0;
  for (const count of perApp.values()) max = Math.max(max, count);
  return { total: totalInFlight, perApp: max };
}

export function _testResetRelay(): void {
  perApp.clear();
  totalInFlight = 0;
}
