// What a close MEANS on the app leg: the event a connection reports, and the one
// rule that decides it when the transport dies rather than saying goodbye.
//
// Split out of the connection because it is a decision, not a mechanism — and
// because getting it wrong is invisible: a peer that vanishes mid-goodbye must not
// look like one that completed the exchange, and a polite goodbye must not be
// recorded as a failure.

export type SendOutcome =
  // Handed to the socket or queued inside the cap.
  | "sent"
  // Over the queue ceiling: the caller's contract is to end the connection.
  | "queue_full"
  // Over the message cap. Refused here so an oversized message never reaches
  // the wire in the browser-to-app direction.
  | "too_large"
  // A close is already in flight; nothing more will be sent.
  | "closing";

export interface UpstreamCloseEvent {
  // The app's close code, or null when it closed without one. `abnormal` marks
  // the cases where no close frame was exchanged at all — the socket dropped, a
  // protocol error, a timeout — which a relay must not report to a browser as a
  // clean goodbye.
  code: number | null;
  reason: string;
  abnormal: boolean;
  // A one-line explanation for the log when this end caused the close.
  detail: string | null;
}

export interface AppUpstreamHandlers {
  // Data messages only: ping, pong and close are handled inside.
  onMessage(message: { kind: "text"; text: string } | { kind: "binary"; data: Buffer }): void;
  // Exactly once, whatever ends the connection.
  onClose(event: UpstreamCloseEvent): void;
}

// Keep the reason a close already had, and add what happened to it. A detail that
// replaced the original would lose the only part a log actually needs.
export function withCause(existing: string | null, cause: string): string {
  return existing === null ? cause : `${existing}; ${cause}`;
}

// The transport ended. ONE rule for both signals that can bring that news — a
// socket close and a socket error — so the two cannot drift into disagreeing about
// what a half-finished close means.
//
// Being asked at all means the connection was not already finished, and that
// narrows things sharply:
//
//   - an echo still OWED (`owedEcho`) is the app-initiated case: its close
//     arrived, ours was queued, and the socket died before those bytes could
//     leave. The handshake did not complete. The peer's code and reason are still
//     the truth about WHY, so they are kept — but calling this clean would make a
//     peer that vanishes mid-goodbye look exactly like one that completed the
//     exchange, which is the same false-clean error in the opposite direction.
//   - a pending close of OUR OWN with nothing owed back is the other direction:
//     we said goodbye and the peer never answered.
//   - neither: nothing was exchanged at all, so there is no code to report.
//
// The completed-handshake cases never arrive here: both of them finish at the
// moment they complete — when the peer answers our close, and when the echo's last
// byte leaves — so a later transport signal is idempotently ignored.
export function closeEventForTransportDeath(owedEcho: UpstreamCloseEvent | null, ours: UpstreamCloseEvent | null, cause: string): UpstreamCloseEvent {
  if (owedEcho !== null) {
    return { ...owedEcho, abnormal: true, detail: withCause(owedEcho.detail, `${cause} before the close echo was sent`) };
  }
  if (ours !== null) {
    return { ...ours, abnormal: true, detail: withCause(ours.detail, `${cause} before the close handshake completed`) };
  }
  return { code: null, reason: "", abnormal: true, detail: `${cause} without a close frame` };
}
