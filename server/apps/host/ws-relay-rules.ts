// The relay's pure decisions: what offer it will parse, what Origin it will
// accept, which codes it closes with, and how one end's ending is spelled to the
// other.
//
// Kept apart from the lifecycle in host-ws-relay-socket.ts because none of it
// touches a socket, and because the close mapping is where a relay is most
// tempted to lie — an app that says goodbye must not reach the browser as a
// dropped connection, and a browser that vanished must not reach the app as a
// polite close.

import { isSafeProtocolToken } from "./ws-handshake.ts";
import { isTransmittableCloseCode, truncateCloseReason } from "./ws-frames.ts";
import type { UpstreamCloseEvent } from "./ws-upstream.ts";

// The largest `Sec-WebSocket-Protocol` offer this relay will parse.
//
// A bound is needed because the offer is FORWARDED: it becomes a header line in
// the upgrade request the upstream client writes, which has its own 16KB
// ceiling. Without a bound here, an absurd offer of syntactically valid tokens
// would pass every check, take a permit, prove the app is running, dial it, and
// only then be refused by that ceiling as a generic "did not respond" — work
// done and a connection opened on behalf of a request that was never going to
// succeed. 1KB sits far enough inside the 16KB ceiling that a legal offer can
// never be the thing that overflows the request, and far above any real
// subprotocol list.
export const APP_WS_MAX_PROTOCOL_HEADER_BYTES = 1024;

// Close codes this relay sends on its own behalf, as opposed to relaying
// someone else's. Named because a bare number in a close call is unreadable.
//
// Backpressure: a queue ceiling was hit in one direction or the other.
//
// 1013 ("try again later") is the semantically perfect code and it is NOT USED,
// for a measured reason. Bun's server validates the close code a PEER sends and
// accepts only 1000-1011 and 4000-4999: a close carrying 1012, 1013, 1014 or
// anything in 3000-3999 reaches the app as 1006 with an empty reason. Since the
// relay is the client on the app leg, sending 1013 would mean the browser hears
// "try again later" while the app hears "the connection dropped" — the exact
// two-ends-disagree failure this relay exists to avoid, and invisible unless a
// test watches the app's own close event.
//
// 1011 is in the accepted set on both legs, means "an unexpected condition
// prevented this from being fulfilled", and is what both ends actually hear.
// (Measured the other direction too: Bun TRANSMITS every code faithfully,
// including 1012-1014 and 3000-3999, so relaying an app's own close code to a
// browser is unaffected by any of this.)
export const CLOSE_BACKPRESSURE = 1011;
export const CLOSE_TOO_LARGE = 1009; // a message over the upstream message cap
export const CLOSE_REVOKED = 1008; // policy: the session or the app went away
export const CLOSE_GOING_AWAY = 1001; // the office is shutting the socket down

// --- the browser's subprotocol offer (pure) ---------------------------------

// The offered list, parsed strictly, or `null` for "this request is malformed".
//
// Strict because of a measured Bun behavior: when the client offers
// subprotocols, `server.upgrade()` ANSWERS with one — the first offered — unless
// we set the header ourselves, and it reads the offer from the raw request, so
// deleting the header off the `Request` object changes nothing. Silently
// treating an unparseable list as "no offer" would therefore not mean "no
// subprotocol"; it would mean Bun picking one we never looked at. A list we
// cannot read is refused instead.
export function parseOfferedProtocols(header: string | null): string[] | null {
  if (header === null) return [];
  // Size before syntax: a megabyte of valid tokens is malformed for our purposes
  // whatever it says, and this is the cheapest check there is.
  if (Buffer.byteLength(header, "utf8") > APP_WS_MAX_PROTOCOL_HEADER_BYTES) {
    return null;
  }
  // Present-but-empty is a client asserting an empty offer, which is not a
  // thing: the header exists to name protocols.
  if (header.trim().length === 0) return null;
  const out: string[] = [];
  for (const part of header.split(",")) {
    const token = part.trim();
    if (!isSafeProtocolToken(token)) return null;
    // A repeated token is a list somebody built by hand; two different layers
    // could disagree about which occurrence won.
    if (out.includes(token)) return null;
    out.push(token);
  }
  return out;
}

// --- origin (pure) -----------------------------------------------------------

// A browser always sends `Origin` on an upgrade, so ABSENT means a client that
// is not a browser — and a client that is not a browser has no ambient cookies
// to be abused. That is the whole argument for allowing it, and it is worth
// stating plainly what it does NOT say: absence is not authentication. The
// caller still has to hold the app session cookie, which is checked before this,
// and a hand-built client can only have one if its owner signed in.
//
// Present, on the other hand, has to be exactly this app's own origin. The app
// host is https by construction (the arm does not exist otherwise), so this is a
// string comparison against a value the office derived, never a header echo.
export function originAllowed(originHeader: string | null, appHost: string): boolean {
  if (originHeader === null) return true;
  return originHeader === `https://${appHost}`;
}

// --- messages and endings ----------------------------------------------------

export type Buffered = { kind: "text"; text: string } | { kind: "binary"; data: Buffer };

export function sizeOf(message: Buffered): number {
  return message.kind === "text" ? Buffer.byteLength(message.text, "utf8") : message.data.length;
}

// How the browser leg should be ended, decided by whoever is finishing.
export type BrowserEnding =
  | { kind: "close"; code: number; reason: string }
  // No close frame: the peer must see 1006, because that is what happened.
  | { kind: "terminate" };

// How BOTH legs should be ended, as one value.
//
// One object rather than two arguments, and this is not tidiness: when the relay
// itself decides to close — a queue ceiling, an oversized message, a revoked
// session — the two ends have to hear the SAME thing. An earlier version passed
// only the browser's ending and told the app a flat 1001 "going away" every time,
// so an app whose client had sent an oversized message learned that the office
// was shutting down rather than that its peer broke a rule. The two legs cannot
// drift apart if there is only one place to write them.
//
// `null` on either side means "nothing to say to that leg": it is already gone,
// was never upgraded, or has already been told (a browser-initiated close tells
// the app before finishing).
export interface RelayEnding {
  browser: BrowserEnding | null;
  upstream: { code: number; reason: string } | null;
}

// A fault the RELAY diagnosed: both ends hear the same code and the same reason.
export function fault(code: number, reason: string): RelayEnding {
  return { browser: { kind: "close", code, reason }, upstream: { code, reason } };
}

// The office is done with this socket and the far end has not been told. Used
// where there is no diagnosis to share — the runtime refused the upgrade, or an
// app-side flood happened before a browser leg ever existed.
export function goingAway(reason: string): RelayEnding {
  return { browser: null, upstream: { code: CLOSE_GOING_AWAY, reason } };
}

// How an upstream close reaches the browser.
//
// The distinction this preserves is the one that matters to client code:
// CLEAN versus DROPPED. A browser reconnect loop triggers on 1006, so reporting
// an app's deliberate goodbye as 1006 would turn a normal shutdown into a
// reconnect storm; reporting a genuinely dropped connection as 1000 would hide a
// failure. Hence: abnormal -> terminate (the browser sees 1006, which is what
// happened), clean -> the app's own code and reason.
//
// A clean close with NO status is the one place a code is invented, and it is
// unavoidable: measured on Bun 1.3.11, `ws.close()` with no arguments puts
// `88 02 03 e8` on the wire — a close frame carrying 1000. Bun's server API
// cannot emit the status-less form at all, so the choice is between 1000 (keeps
// the close in the CLEAN family, invents a status) and 1006 (keeps "no status",
// moves a deliberate goodbye into the FAILED family). 1000 is the smaller lie,
// and RFC 6455 7.1.5 already treats a status-less close as a normal one.
export function endingFor(event: UpstreamCloseEvent): BrowserEnding {
  if (event.abnormal) return { kind: "terminate" };
  if (event.code === null) return { kind: "close", code: 1000, reason: "" };
  if (!isTransmittableCloseCode(event.code)) return { kind: "terminate" };
  return {
    kind: "close",
    code: event.code,
    // Bun truncates a too-long reason silently at 123 bytes and can cut a
    // character in half; the codec's helper cuts on a code-point boundary.
    reason: truncateCloseReason(event.reason),
  };
}
