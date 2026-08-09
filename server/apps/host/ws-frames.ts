// WebSocket frame codec for the app relay: the wire constants, the close-code
// grammar, and the client-to-server encoder.
//
// The relay behind app hostnames needs to speak WebSocket to an app on
// loopback. Bun has a WebSocket client, and this relay started with it — but it
// buffers writes with no observable bound: `bufferedAmount` reads 0 no matter
// what, and 120MB of sends to an app that had stopped reading grew the process
// to 211MB RSS with nothing to notice it by (measured, Bun 1.3.11). The office
// is a single process holding every agent's state, so an app that stops reading
// must not be able to grow it. A raw TCP socket, by contrast, reports exactly
// what we need: `write()` returns a short count or zero when the peer is not
// draining, keeps nothing of its own, and calls `drain` when the peer resumes.
// That is why this file exists — not because hand-rolling a protocol is fun, but
// because it is the only version of this relay whose memory can be stated.
//
// So: this is deliberately NOT a WebSocket library. It is the exact slice of
// RFC 6455 a relay needs, in the one direction a relay needs it —
// client-to-server writes (masked, as a client must) and server-to-client reads
// (decoded in host-ws-decoder.ts). No extensions, no compression, no autobahn
// ambitions.
//
// THE APP IS UNTRUSTED INPUT HERE. An app is code the office runs, which is a
// long way from code the office should let write its parser's arithmetic: an
// agent wrote it in a scratch directory, and it may be malicious or simply
// broken in the way a half-finished server is. So every length is checked
// against the cap BEFORE anything is allocated for it, a 64-bit length is
// compared as a BigInt so no value can round its way past a limit, and a
// protocol violation ends the connection with a code instead of being guessed
// at. Nothing here allocates in proportion to a number the app chose.

import { randomBytes } from "crypto";

// --- the wire ---------------------------------------------------------------

export const OPCODE_CONTINUATION = 0x0;
export const OPCODE_TEXT = 0x1;
export const OPCODE_BINARY = 0x2;
export const OPCODE_CLOSE = 0x8;
export const OPCODE_PING = 0x9;
export const OPCODE_PONG = 0xa;

// A control frame's payload cannot be fragmented and cannot exceed 125 bytes
// (RFC 6455 section 5.5), which is also what bounds a close reason.
export const MAX_CONTROL_PAYLOAD_BYTES = 125;

// A close frame's reason, in BYTES rather than characters. The frame carries a
// 2-byte code first, so 125 - 2 is what is left for the reason.
export const MAX_CLOSE_REASON_BYTES = MAX_CONTROL_PAYLOAD_BYTES - 2;

// The largest header a frame can have: 2 bytes of framing, 8 for a 64-bit
// length, 4 for a mask. Used to bound the parser's own scratch buffer.
export const MAX_FRAME_HEADER_BYTES = 14;

// --- close codes ------------------------------------------------------------

// Close codes that may legitimately appear on the wire. Everything outside this
// set is either reserved for a local condition that cannot be transmitted
// (1005 no-status, 1006 abnormal, 1015 TLS failure), unassigned, or outside the
// grammar — and a peer sending one is making a protocol error rather than
// telling us something.
//
// The same set governs both directions, which is the point: it is what the
// decoder accepts from an app and what the relay is allowed to pass to a
// browser, so the two cannot drift into disagreeing about what a valid close is.
const TRANSMITTABLE_CLOSE_CODES = new Set([1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014]);

export function isTransmittableCloseCode(code: number): boolean {
  if (!Number.isInteger(code)) return false;
  if (TRANSMITTABLE_CLOSE_CODES.has(code)) return true;
  // 3000-3999 registered by libraries, 4000-4999 private use. Both are
  // application territory and pass through untouched.
  return code >= 3000 && code <= 4999;
}

// A close reason, cut to fit a control frame WITHOUT splitting a character.
// Bun truncates a too-long reason silently at 123 bytes (measured), which can
// land mid-sequence and put invalid UTF-8 on the wire; a peer validating the
// reason is then entitled to answer 1007. Cutting on a code-point boundary
// means the worst case is a shorter message, not a malformed one.
export function truncateCloseReason(reason: string): string {
  const bytes = Buffer.from(reason, "utf8");
  if (bytes.length <= MAX_CLOSE_REASON_BYTES) return reason;
  let end = MAX_CLOSE_REASON_BYTES;
  // Walk back off any continuation byte (10xxxxxx) so the cut lands where a
  // character starts.
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString("utf8");
}

// --- encoding ---------------------------------------------------------------

// A client's frames MUST be masked (RFC 6455 section 5.3), and the mask has to
// be unpredictable: it exists so a hostile page cannot steer the plaintext of
// bytes an intermediary might interpret. `randomBytes` rather than Math.random
// for that reason, per frame.
function maskingKey(): Buffer {
  return randomBytes(4);
}

// One complete frame, masked, ready to write. The payload is COPIED before it
// is masked: the caller's buffer may be Bun's own inbound frame from the
// browser, and masking in place would corrupt the very bytes we are relaying.
export function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const mask = maskingKey();
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.alloc(6);
    header[1] = 0x80 | len;
    mask.copy(header, 2);
  } else if (len < 0x10000) {
    header = Buffer.alloc(8);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
    mask.copy(header, 4);
  } else {
    header = Buffer.alloc(14);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
    mask.copy(header, 10);
  }
  // FIN always set: the relay never fragments what it sends. A message it
  // received whole goes out whole, which keeps the sender's framing intact for
  // anything that cares and keeps this encoder free of fragmentation state.
  header[0] = 0x80 | opcode;
  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([header, masked]);
}

export function encodeTextFrame(text: string): Buffer {
  return encodeFrame(OPCODE_TEXT, Buffer.from(text, "utf8"));
}

export function encodeBinaryFrame(data: Buffer): Buffer {
  return encodeFrame(OPCODE_BINARY, data);
}

export function encodePingFrame(payload: Buffer): Buffer {
  return encodeFrame(OPCODE_PING, payload);
}

// A ping's payload must come back verbatim in the pong (RFC 6455 section
// 5.5.3), because that is what makes a pong attributable to the ping that
// asked for it.
export function encodePongFrame(payload: Buffer): Buffer {
  return encodeFrame(OPCODE_PONG, payload);
}

// A close frame. `code === null` sends an EMPTY payload, which is how "closing,
// no status" is expressed on the wire — the 1005 that cannot be sent as a
// number. The reason is dropped with it, since a reason cannot be sent without
// a code.
export function encodeCloseFrame(code: number | null, reason = ""): Buffer {
  if (code === null) return encodeFrame(OPCODE_CLOSE, Buffer.alloc(0));
  const reasonBytes = Buffer.from(truncateCloseReason(reason), "utf8");
  const payload = Buffer.allocUnsafe(2 + reasonBytes.length);
  payload.writeUInt16BE(code, 0);
  reasonBytes.copy(payload, 2);
  return encodeFrame(OPCODE_CLOSE, payload);
}
