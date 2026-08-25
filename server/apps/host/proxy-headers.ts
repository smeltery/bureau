// The header rules the HTTP relay (server/apps/host/proxy.ts) applies in each
// direction, and nothing else: every function here is pure, so what an app is
// and is not handed can be pinned without a socket.
//
// Its own module because these sets ARE the relay's security surface — the
// cookies that never leave the office, the forwarding headers the relay owns,
// the hop-by-hop headers that stop at a proxy — and a set that is hard to find
// is a set somebody edits by accident.

import { COOKIE_NAME, HOST_COOKIE_NAME } from "../../auth/http-env.ts";
import { APP_COOKIE_NAME } from "./auth-cookie.ts";

// RFC 7230 section 6.1: connection-specific, never forwarded by a proxy in
// either direction. `Connection` also NAMES further headers that are
// connection-specific for this message; those are collected per-message below.
const HOP_BY_HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);

// Headers the RELAY owns on the way in. A client-supplied value is dropped
// before ours is written, so an app can trust these exactly as far as it trusts
// bureau — and no further, which is the honest position.
const RELAY_OWNED_REQUEST_HEADERS = new Set(["host", "forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-port", "x-forwarded-proto"]);

// Content codings Bun's fetch decodes transparently.
//
// This set exists because of a measurement, and it has to keep matching a
// measurement rather than the spec. A gzip response arrives here with its body
// ALREADY DECOMPRESSED and its `Content-Encoding: gzip` plus the COMPRESSED
// `Content-Length` still attached, so forwarding those verbatim hands the
// browser a lie about the bytes and a wrong framing for them. Sending
// `Accept-Encoding: identity` upstream does not prevent it (also measured).
//
// Matching is driven by what Bun 1.4's fetch decodes: single-token codings are
// compared case-insensitively (`gzip`, `GZIP`, `x-gzip`), and comma-separated
// lists are accepted when any listed token is decoded (`identity, gzip`). A
// test pins the decoder's behavior directly: if a runtime upgrade widens it,
// that test fails and points here rather than shipping broken bytes.
const DECODED_CODINGS = new Set(["gzip", "x-gzip", "deflate", "br", "zstd"]);

// Cookies that never leave the office, whoever sent them.
//
// `__Host-bureau_app` is the load-bearing one: it is the credential that opens
// THIS app, and an app holding it could open itself as its own visitor. The two
// office session names are stripped for the same reason one level up — an app
// handed a live office session could act as that user against the office API. No
// browser sends any of the three to a child host (all are host-only), so a
// request carrying one was hand-built, and there is nothing to preserve for it.
//
// Names are matched EXACTLY, and cookie names are case-sensitive (RFC 6265): an
// app's own `bureau_session_id` or `BUREAU_SESSION` is its own business and
// passes through.
const STRIPPED_COOKIE_NAMES = new Set([APP_COOKIE_NAME, HOST_COOKIE_NAME, COOKIE_NAME]);

// The header names a message's own `Connection` header nominates as
// connection-specific. Comma-separated, case-insensitive tokens.
function connectionNominated(headers: Headers): Set<string> {
  const out = new Set<string>();
  const value = headers.get("connection");
  if (!value) return out;
  for (const token of value.split(",")) {
    const name = token.trim().toLowerCase();
    if (name.length > 0) out.add(name);
  }
  return out;
}

// Did Bun decode this response on the way in? Whitespace is trimmed because
// the decoder trims too (measured: ` gzip` and `gzip ` are both decoded);
// nothing else is normalized, for the reason above.
export function carriesDecodedCoding(contentEncoding: string | null): boolean {
  if (contentEncoding === null) return false;
  for (const token of contentEncoding.split(",")) {
    const coding = token.trim().toLowerCase();
    if (coding.length > 0 && DECODED_CODINGS.has(coding)) return true;
  }
  return false;
}

// The Cookie header with every bureau credential removed, or null when nothing
// is left worth sending. Splitting on `;` is the whole grammar: cookie VALUES
// cannot contain a semicolon or a comma unquoted, so there is no ambiguity to
// get wrong here.
export function stripBureauCookies(header: string | null): string | null {
  if (header === null) return null;
  const kept: string[] = [];
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    const eq = trimmed.indexOf("=");
    const name = eq === -1 ? trimmed : trimmed.slice(0, eq);
    if (STRIPPED_COOKIE_NAMES.has(name)) continue;
    kept.push(trimmed);
  }
  return kept.length > 0 ? kept.join("; ") : null;
}

// The peer address as an `X-Forwarded-For` node.
//
// Bun reports a loopback peer on a dual-stack socket as `::ffff:127.0.0.1` —
// the IPv4-mapped IPv6 form, which server/auth/auth-request-guards.ts already
// has to know about. It is the same address written a way most XFF parsers have
// never seen, so the mapping is unwrapped here. A genuine IPv6 peer is written
// bare, which is what every terminator that writes this header does; the
// bracketed form belongs to the `Forwarded` header's grammar, not this one.
export function forwardedForValue(peer: string | null): string | null {
  if (peer === null || peer.length === 0) return null;
  const mapped = /^::ffff:((?:[0-9]{1,3}\.){3}[0-9]{1,3})$/i.exec(peer);
  return mapped ? mapped[1] : peer;
}

// The headers the app sees. `peerAddress` is the TCP peer of the office's own
// listener — which, on every deployment that has app hostnames, is the local
// terminator rather than the browser. That is deliberate and it is the honest
// answer: the office socket is directly reachable, so an inbound
// `X-Forwarded-For` is client-settable and cannot be promoted to truth by
// relaying it. An app therefore learns who connected to the office, not who the
// user is. Absent peer -> no header at all, rather than a literal "unknown"
// sitting where an address belongs.
export function buildUpstreamHeaders(req: Request, appHost: string, peerAddress: string | null | undefined): Headers {
  const drop = connectionNominated(req.headers);
  const out = new Headers();
  for (const [name, value] of req.headers) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || drop.has(lower)) continue;
    if (RELAY_OWNED_REQUEST_HEADERS.has(lower)) continue;
    if (lower === "cookie") continue; // handled below
    out.set(name, value);
  }
  const cookie = stripBureauCookies(req.headers.get("cookie"));
  if (cookie !== null) out.set("Cookie", cookie);
  // The VERIFIED host — the normalized name the arm matched against the
  // registry — never the raw `Host` line the client wrote.
  out.set("Host", appHost);
  out.set("X-Forwarded-Host", appHost);
  // The app-host arm only exists on an https office, so this is a constant
  // rather than a reading of anything.
  out.set("X-Forwarded-Proto", "https");
  const forwardedFor = forwardedForValue(peerAddress ?? null);
  if (forwardedFor !== null) out.set("X-Forwarded-For", forwardedFor);
  return out;
}

// The headers the browser sees.
export function buildDownstreamHeaders(upstream: Response, opts: { rewriteEncoding: boolean }): Headers {
  const drop = connectionNominated(upstream.headers);
  const out = new Headers();
  const rewrite = opts.rewriteEncoding && carriesDecodedCoding(upstream.headers.get("content-encoding"));
  for (const [name, value] of upstream.headers) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || drop.has(lower)) continue;
    // Set-Cookie is handled below: iterating a Headers object folds repeated
    // field lines into one comma-joined value, and an `Expires` date contains a
    // comma — so re-appending that string would hand the browser one malformed
    // cookie instead of two good ones.
    if (lower === "set-cookie") continue;
    if (rewrite && (lower === "content-encoding" || lower === "content-length")) continue;
    out.set(name, value);
  }
  // getSetCookie() is the multi-value read; append is the multi-value write.
  for (const line of upstream.headers.getSetCookie()) {
    out.append("Set-Cookie", line);
  }
  return out;
}
