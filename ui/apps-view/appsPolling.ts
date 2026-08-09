// The Apps tab's two async rules: when a response is allowed to write to shared
// state, and when the polling loop is allowed to schedule itself again.
//
// TWO SOURCES OF TRUTH, DELIBERATELY. The app_updated / app_removed deltas carry
// anything bureau itself did, immediately. But the supervisor restarting a
// crash-looping app is not something bureau is told about — the restart count
// only moves when somebody asks — so the list is also re-fetched every few
// seconds WHILE THE TAB IS OPEN, and never when it is closed. The fetch replaces
// the slice; the deltas patch it; both converge.

// How often the open tab re-asks for the list. The server caches app state
// behind the supervisor seam, so several open tabs cost at most one supervisor
// read per cache window rather than one per tab per tick.
export const POLL_MS = 5000;

/**
 * Should a response that has just come back be allowed to write to the shared
 * state it was fetched for? Extracted and exported because the UI has no React
 * render harness and this is the whole of the race: a request is only allowed to
 * land if nothing has moved on since it was issued.
 *
 * `gen` rules out a superseded request (a second click, a close, an unmount);
 * `target` rules out a response arriving under a DIFFERENT row than the one it
 * was asked for — the case where A's log would briefly appear under B. A null
 * current target means nothing is open, so nothing may be written.
 */
export function shouldCommit(issuedGen: number, currentGen: number, issuedTarget: string, currentTarget: string | null): boolean {
  return issuedGen === currentGen && issuedTarget === currentTarget;
}

/**
 * How long to wait before the next poll, or null to stop entirely. Exported for
 * the same reason as shouldCommit: this is the decision that keeps a cancelled
 * polling loop from rescheduling itself, and it is worth pinning even though the
 * lifetime it belongs to (a local `let` per effect run, NOT a ref) can only be
 * shown structurally without a React render harness.
 */
export function nextPollDelay(cancelled: boolean, landed: boolean): number | null {
  if (cancelled) return null;
  return landed ? POLL_MS : 0;
}
