// What a live relayed socket costs, and how it keeps proving it is allowed to
// exist.
//
// Every part of this is about a connection that OUTLIVES the request that opened
// it: a browser tab can hold one for days, so the ceiling below is what the office
// spends on it, the send that enforces that ceiling is here beside it, and the
// re-check is what stops a revoked session from keeping the socket alive.

import type { AppRecord } from "../../../shared/apps.ts";
import { validateAppSession } from "./auth-store.ts";
import { sizeOf, type Buffered } from "./ws-relay-rules.ts";
import type { AppRegistry } from "../registry.ts";

// What the browser leg may have outstanding before the relay stops feeding it.
// Matched to the upstream queue ceiling so the two directions cost the same, and
// far below Bun's own ~16MB limit so the number that governs is OURS.
//
// THE BOUND THIS BUYS IS HONEST BUT NOT TOTAL, and the difference matters:
// `getBufferedAmount()` reads 0 while the kernel is still absorbing writes
// (measured), so what this ceiling actually caps is Bun's queue, not the socket
// buffer underneath it. Per connection: the upstream client's ~3.5MB, plus this
// 512KB, plus whatever Bun and the kernel hold for a socket that has already
// accepted bytes — bounded by Bun's own backpressure limit and SO_SNDBUF, which
// are not ours to set. Overclaiming a tidier number would be the kind of memory
// statement that reads well and is wrong.
export const APP_WS_BROWSER_BUFFER_MAX_BYTES = 512 * 1024;

// How often a live socket re-proves it is still allowed to exist.
//
// A timer rather than a per-message check, deliberately: per-message would make
// an idle socket immortal (a revoked session on a quiet connection would never
// be noticed) and a busy one pay for the check thousands of times a second. The
// HTTP relay revalidates per request because a request IS the unit there; here
// the unit is a connection that can outlive any number of revocations.
export const APP_WS_SESSION_RECHECK_MS = 30_000;

// What the relay holds about the session behind the socket, so the revalidation
// timer can ask the same questions the handshake asked.
export interface RelaySession {
  // Held for the life of the socket. The browser holds this value too, and the
  // office already holds its hash; nothing new is exposed by keeping it.
  token: string | null;
  app: Pick<AppRecord, "hostLabel" | "hostGen" | "userId">;
  registry: AppRegistry;
}

// Is this socket still allowed to exist? Asked of the same two authorities the
// handshake asked: the registry (which fails when the app is deleted or its name
// re-registered into a new generation) and the app session (which fails the moment
// the office session behind it is revoked, expires, or its user is deleted).
//
// Fail-closed on a registry that cannot be read: an unreadable registry is not a
// yes, and the socket goes.
export function relaySocketStillAllowed(session: RelaySession): { ok: true } | { ok: false; detail: string } {
  let stillTheApp = false;
  try {
    stillTheApp = session.registry.list().some((app) => app.hostLabel === session.app.hostLabel && app.hostGen === session.app.hostGen);
  } catch (err) {
    console.error("[app-ws-relay] registry unreadable; closing socket:", err);
    stillTheApp = false;
  }
  const stillSignedIn = validateAppSession(session.token, { app: session.app });
  if (stillTheApp && stillSignedIn) return { ok: true };
  return { ok: false, detail: stillTheApp ? "app session is no longer valid" : "app is gone" };
}

// The browser leg, as much of it as the ceiling above concerns: what the runtime
// is holding, and what it did with the message. A structural type rather than
// Bun's own, so the two answers that drive the whole policy are the only surface.
export interface BrowserLegSocket {
  getBufferedAmount(): number;
  send(data: string | Buffer): number;
}

// Hand one message to the browser leg, inside the ceiling.
//
// The ceiling is checked BEFORE the send, not after: a post-hoc check lets one
// whole message past every time, and the ceiling is what the memory statement is
// written in terms of.
//
// Measured (Bun 1.3.11): send() answers a byte count when it took the message, -1
// when it enqueued it, 0 when it DROPPED it past its own backpressure limit. A
// dropped frame is not a slow client, it is a hole in the stream, and a relay that
// keeps going after one is lying to both ends. An empty message also returns 0,
// which is not a drop — hence the size guard.
export function sendWithinBrowserCeiling(ws: BrowserLegSocket, message: Buffered, maxBytes: number): "sent" | "over_ceiling" | "dropped" {
  const size = sizeOf(message);
  if (ws.getBufferedAmount() + size > maxBytes) return "over_ceiling";
  const written = message.kind === "text" ? ws.send(message.text) : ws.send(message.data);
  return size > 0 && written === 0 ? "dropped" : "sent";
}
