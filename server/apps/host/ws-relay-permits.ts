// The relay's socket pool: how many WebSockets may be open through app
// hostnames at once, office-wide and per app.
//
// Their own pool, deliberately separate from the HTTP relay's permits — the two
// resources are not alike. An HTTP request occupies a permit for as long as one
// response takes; a WebSocket holds one for as long as a browser tab stays open,
// so sharing a pool would let a chat app with thirty tabs starve the office's
// ordinary traffic.

import type { AppRecord } from "../../../shared/apps.ts";

export const APP_WS_MAX_SOCKETS_TOTAL = 64;
export const APP_WS_MAX_SOCKETS_PER_APP = 32;

// Keyed by ISSUANCE — label plus generation — and never by an app's name. A name
// is reusable: an app can be deleted and re-registered while one of its sockets
// is still unwinding, and a release from the dead app must not decrement the live
// one's bucket. A label is issued once, forever.
export function permitKey(app: AppRecord): string {
  return `${app.hostLabel}#${app.hostGen}`;
}

const perApp = new Map<string, number>();
let totalOpen = 0;

export interface SocketPermit {
  release(): void;
}

// Both counters move in ONE synchronous turn, and neither moves until BOTH
// limits have said yes — so there is no half-taken permit to roll back, and no
// leaked count when the two disagree.
export function acquireSocketPermit(key: string, limits: { perApp: number; total: number }): SocketPermit | null {
  const forApp = perApp.get(key) ?? 0;
  if (forApp >= limits.perApp) return null;
  if (totalOpen >= limits.total) return null;
  perApp.set(key, forApp + 1);
  totalOpen++;
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      totalOpen--;
      const left = (perApp.get(key) ?? 1) - 1;
      // Buckets are deleted at zero: a map that only ever grows is a leak with a
      // slow fuse, and app labels are issued forever.
      if (left <= 0) perApp.delete(key);
      else perApp.set(key, left);
    },
  };
}

export function _testWsSocketsOpen(): { total: number; perApp: number } {
  let max = 0;
  for (const count of perApp.values()) max = Math.max(max, count);
  return { total: totalOpen, perApp: max };
}

export function _testResetWsRelay(): void {
  perApp.clear();
  totalOpen = 0;
}
