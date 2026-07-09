type ClosableSocket = { send?: (data: string) => void; close: () => void };

const wsBySession = new Map<string, Set<ClosableSocket>>();

export function registerSocket(sessionIdHash: string, ws: ClosableSocket) {
  let set = wsBySession.get(sessionIdHash);
  if (!set) {
    set = new Set();
    wsBySession.set(sessionIdHash, set);
  }
  set.add(ws);
}

export function unregisterSocket(sessionIdHash: string, ws: ClosableSocket) {
  const set = wsBySession.get(sessionIdHash);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) wsBySession.delete(sessionIdHash);
}

// Notify-then-close contract for server-initiated session invalidation:
// revoke, logout, expiry, orphan-after-user-delete. The client's WS
// onclose handler blindly retries on close, so closing without
// `session_expired` first leaves the browser in a 2s reconnect loop
// against a 401-returning upgrade.
export function forceExpireSocketsForSession(sessionIdHash: string) {
  const set = wsBySession.get(sessionIdHash);
  if (!set) return;
  for (const ws of set) {
    try {
      ws.send?.(JSON.stringify({ type: "session_expired" }));
    } catch {}
    try {
      ws.close();
    } catch {}
  }
  wsBySession.delete(sessionIdHash);
}
