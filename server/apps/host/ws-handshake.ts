// The HTTP upgrade the relay writes to an app, and the response it will accept
// back. Pure: no socket, no policy, no state.
//
// Split out of the upstream client so the two halves that are only string and
// byte arithmetic can be read — and tested — without a peer at the other end.

import { createHash } from "crypto";

// The fixed GUID every WebSocket handshake hashes with (RFC 6455 section 1.3).
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// --- request building (pure) -------------------------------------------------

// A header name must be an RFC 7230 token, and a value must carry no control
// character. This is not pedantry: the request below is BYTES, assembled with
// CRLFs, and these names and values come from a browser's request. A value
// holding a CRLF would let a visitor write extra headers — or a whole extra
// request — into what the app receives.
const TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

export function isSafeHeaderName(name: string): boolean {
  return TOKEN_PATTERN.test(name);
}

export function isSafeHeaderValue(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    // No CR, LF, NUL or any other C0 control; no DEL. A leading or trailing
    // space is legal in a field value and harmless.
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

// The request target, which is a path the office already validated and then
// re-serialized from a URL — so this is a last structural check rather than the
// first: one leading slash, no whitespace, printable ASCII only.
export function isSafeRequestTarget(target: string): boolean {
  if (!target.startsWith("/")) return false;
  for (let i = 0; i < target.length; i++) {
    const code = target.charCodeAt(i);
    if (code <= 0x20 || code >= 0x7f) return false;
  }
  return true;
}

// A subprotocol token, as offered by the client. Anything else is not something
// to pass along, because the value ends up in a header line.
export function isSafeProtocolToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

export interface HandshakeRequest {
  target: string;
  host: string;
  key: string;
  protocols: string[];
  headers: Record<string, string>;
}

// The upgrade request as bytes. Every header the client owns is written HERE, so
// a caller-supplied duplicate cannot appear twice with different values: the
// caller's headers are filtered by the relay before they arrive, and the four
// names below are re-checked as a backstop.
const CLIENT_OWNED_HEADERS = new Set([
  "host",
  "upgrade",
  "connection",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-protocol",
  "sec-websocket-extensions",
  "content-length",
  "transfer-encoding",
]);

export function buildHandshakeRequest(req: HandshakeRequest): Buffer | null {
  if (!isSafeRequestTarget(req.target)) return null;
  if (!isSafeHeaderValue(req.host) || req.host.length === 0) return null;
  if (!req.protocols.every(isSafeProtocolToken)) return null;
  const lines = [`GET ${req.target} HTTP/1.1`, `Host: ${req.host}`, "Upgrade: websocket", "Connection: Upgrade", "Sec-WebSocket-Version: 13", `Sec-WebSocket-Key: ${req.key}`];
  if (req.protocols.length > 0) {
    lines.push(`Sec-WebSocket-Protocol: ${req.protocols.join(", ")}`);
  }
  // No Sec-WebSocket-Extensions line at all: this client negotiates none, which
  // is why the decoder can refuse a frame with a reserved bit set, and why there
  // is no compression path over untrusted app bytes.
  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase();
    if (CLIENT_OWNED_HEADERS.has(lower)) continue;
    if (!isSafeHeaderName(name) || !isSafeHeaderValue(value)) return null;
    lines.push(`${name}: ${value}`);
  }
  return Buffer.from(`${lines.join("\r\n")}\r\n\r\n`, "utf8");
}

export function handshakeAccept(key: string): string {
  return createHash("sha1")
    .update(key + WS_GUID)
    .digest("base64");
}

// --- handshake response validation (pure) ------------------------------------

export type HandshakeCheck =
  | { ok: true; protocol: string | null }
  // `rejected` is an app that answered something other than an upgrade — a
  // page, a 404, a redirect. `invalid` is an app that tried to upgrade and got
  // it wrong. `protocol` is the narrow subprotocol-negotiation case, split out
  // because the relay owes that one a different, debuggable answer: the browser
  // asked for an application protocol and the app did not agree to it, which is
  // the caller's problem to fix rather than a broken app. The distinction is the
  // caller's, not cosmetic, and it is carried as a field rather than sniffed out
  // of the message text.
  | { ok: false; kind: "rejected" | "invalid" | "protocol"; detail: string };

// Comma-separated field value as lowercase tokens, for the two headers whose
// meaning is "contains this token" rather than "equals this string".
function tokens(value: string | undefined): Set<string> {
  const out = new Set<string>();
  if (value === undefined) return out;
  for (const part of value.split(",")) {
    const token = part.trim().toLowerCase();
    if (token.length > 0) out.add(token);
  }
  return out;
}

export function checkHandshakeResponse(head: string, expectedAccept: string, offeredProtocols: string[]): HandshakeCheck {
  const lines = head.split("\r\n");
  const status = lines[0] ?? "";
  // Only 101 is an upgrade. Anything else — a 200 page, a 404, a redirect — is
  // an app that is not speaking WebSocket on this path.
  // HTTP/1.1 exactly: RFC 6455's handshake is defined on 1.1, and a 1.0 response
  // claiming 101 is a peer whose framing assumptions we cannot rely on.
  if (!/^HTTP\/1\.1 101(?:\s|$)/.test(status)) {
    return { ok: false, kind: "rejected", detail: `upgrade refused: ${status.slice(0, 80)}` };
  }
  const headers = new Map<string, string[]>();
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    const existing = headers.get(name);
    if (existing) existing.push(value);
    else headers.set(name, [value]);
  }
  const one = (name: string): string | undefined => {
    const all = headers.get(name);
    return all !== undefined && all.length === 1 ? all[0] : undefined;
  };
  if (!tokens(one("connection")).has("upgrade")) {
    return { ok: false, kind: "invalid", detail: "response Connection does not name upgrade" };
  }
  if (!tokens(one("upgrade")).has("websocket")) {
    return { ok: false, kind: "invalid", detail: "response Upgrade is not websocket" };
  }
  const accept = one("sec-websocket-accept");
  if (accept !== expectedAccept) {
    // The accept value proves the peer read our key and is answering THIS
    // handshake — the check that keeps a cached or cross-wired response from
    // being taken for an open connection.
    return { ok: false, kind: "invalid", detail: "Sec-WebSocket-Accept does not match" };
  }
  if (headers.has("sec-websocket-extensions")) {
    // We offered none, so any answer here is an extension the peer expects us to
    // apply to every frame — and we would not.
    return { ok: false, kind: "invalid", detail: "server answered with an unoffered extension" };
  }
  const protocolLines = headers.get("sec-websocket-protocol") ?? [];
  if (protocolLines.length > 1) {
    return { ok: false, kind: "invalid", detail: "multiple Sec-WebSocket-Protocol values" };
  }
  if (protocolLines.length === 0) {
    // No subprotocol chosen. Fine whether or not any were offered: the client
    // asked, the server declined, and the connection is plain WebSocket.
    return { ok: true, protocol: null };
  }
  const chosen = protocolLines[0];
  if (!offeredProtocols.includes(chosen)) {
    return { ok: false, kind: "protocol", detail: `server chose an unoffered subprotocol: ${chosen.slice(0, 40)}` };
  }
  return { ok: true, protocol: chosen };
}
