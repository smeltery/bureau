// The server-to-client half of the app relay's WebSocket codec: a streaming
// frame decoder over a byte stream.
//
// The decoder is a state machine over a byte stream because that is what TCP
// hands you: a frame arrives split across three reads, or three frames arrive
// in one read, or the handshake's last byte and a frame's first byte arrive
// together. Its tests split a fixed corpus at every byte boundary for exactly
// that reason.
//
// THE APP IS UNTRUSTED INPUT HERE — see host-ws-frames.ts for the full argument.
// Every length is checked against the cap BEFORE anything is allocated for it, a
// 64-bit length is compared as a BigInt so no value can round its way past a
// limit, and a protocol violation ends the connection with a code instead of
// being guessed at.

import { MAX_CONTROL_PAYLOAD_BYTES, OPCODE_BINARY, OPCODE_CLOSE, OPCODE_CONTINUATION, OPCODE_PING, OPCODE_PONG, OPCODE_TEXT, isTransmittableCloseCode } from "./ws-frames.ts";

export type DecodedMessage =
  // Text arrives validated: a decoder that handed back replacement characters
  // would be silently rewriting an app's bytes.
  | { kind: "text"; text: string }
  | { kind: "binary"; data: Buffer }
  | { kind: "ping"; payload: Buffer }
  | { kind: "pong"; payload: Buffer }
  // `code === null` is a close with no status — the wire form of 1005.
  | { kind: "close"; code: number | null; reason: string };

// A protocol failure, carrying the close code the connection should end with.
// 1002 protocol error, 1007 invalid payload data, 1009 message too big: the
// three RFC codes a relay's parser can honestly produce.
export interface DecodeFailure {
  code: 1002 | 1007 | 1009;
  detail: string;
}

// What the decoder does with each message it completes. Returning "stop" leaves
// the rest of the buffered bytes unparsed — the caller is closing and nothing
// further concerns it.
export type DeliverMessage = (message: DecodedMessage) => "continue" | "stop";

export type DecodeResult = { ok: true; stopped: boolean } | { ok: false; failure: DecodeFailure };

// Strict UTF-8. `Buffer.toString("utf8")` substitutes U+FFFD for anything
// malformed, which would turn an app's broken frame into text that looks fine;
// `fatal` makes it an error, which is what the RFC asks for (1007).
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

function decodeUtf8(bytes: Buffer): string | null {
  try {
    return strictUtf8.decode(bytes);
  } catch {
    return null;
  }
}

export interface FrameDecoderOptions {
  // The largest complete message this decoder will assemble, in payload bytes,
  // applied to a single frame AND to the running total of a fragmented
  // sequence. Exceeding it fails with 1009 the moment the length is known —
  // before any buffer is sized for it.
  maxMessageBytes: number;
}

// A streaming decoder for the server-to-client direction.
//
// Two pieces of state, and they are the whole design: `buffer` is the bytes that
// have arrived but not yet formed a frame, and `fragments` is the message being
// assembled across frames. Both are bounded — the first by one frame's header
// plus one message, the second by the message cap — so a peer that sends a
// header and then stops, or fragments forever, cannot grow the process.
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private fragmentBytes = 0;
  private fragmentOpcode: number | null = null;
  private failed = false;
  private readonly maxMessageBytes: number;

  constructor(opts: FrameDecoderOptions) {
    this.maxMessageBytes = opts.maxMessageBytes;
  }

  // Bytes buffered but not yet decoded, plus whatever a partial message is
  // holding. The relay writes its memory bound in terms of this.
  pendingBytes(): number {
    return this.buffer.length + this.fragmentBytes;
  }

  // Feed one TCP read, delivering each complete message AS IT IS DECODED.
  //
  // Delivery is a callback rather than a returned array for a memory reason, not
  // a stylistic one: one read can contain hundreds of frames, and returning them
  // together would mean every message in that read is retained at once — a
  // multiple of the chunk that no accounting here would show. Handing each one
  // over and forgetting it keeps exactly one decoded message in hand, which is
  // the number the relay's stated bound is written around.
  //
  // After a failure the decoder is spent: it refuses further input rather than
  // continuing to parse a stream it has already declared broken.
  push(chunk: Buffer, deliver: DeliverMessage): DecodeResult {
    if (this.failed) {
      return { ok: false, failure: { code: 1002, detail: "decoder is spent" } };
    }
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const step = this.readFrame();
      if (step === null) break; // need more bytes
      if (!step.ok) {
        this.failed = true;
        this.buffer = Buffer.alloc(0);
        this.fragments = [];
        this.fragmentBytes = 0;
        return step;
      }
      if (step.message === null) continue; // a fragment, not yet a message
      if (deliver(step.message) === "stop") return { ok: true, stopped: true };
    }
    return { ok: true, stopped: false };
  }

  // One frame, or null when the buffer does not hold a whole one yet. A frame
  // that completes no message (a fragment that is not the last) returns a null
  // message.
  private readFrame(): { ok: true; message: DecodedMessage | null } | { ok: false; failure: DecodeFailure } | null {
    const buf = this.buffer;
    if (buf.length < 2) return null;
    const first = buf[0];
    const second = buf[1];
    const fin = (first & 0x80) !== 0;
    // RSV1-3 are extension territory, and this client negotiates no
    // extensions, so any of them set means the peer is speaking something we
    // never agreed to.
    if ((first & 0x70) !== 0) {
      return fail(1002, "reserved bits set with no extension negotiated");
    }
    const opcode = first & 0x0f;
    // A server never masks (RFC 6455 section 5.1). Accepting a masked frame
    // would mean guessing at which of us is confused.
    if ((second & 0x80) !== 0) {
      return fail(1002, "server frame is masked");
    }

    let payloadLength = second & 0x7f;
    let offset = 2;
    if (payloadLength === 126) {
      if (buf.length < 4) return null;
      payloadLength = buf.readUInt16BE(2);
      offset = 4;
    } else if (payloadLength === 127) {
      if (buf.length < 10) return null;
      // As a BigInt, compared as a BigInt: a 64-bit length converted to a
      // Number first can lose precision above 2^53 and compare as something it
      // is not.
      const big = buf.readBigUInt64BE(2);
      // STRUCTURE BEFORE SIZE. The RFC requires the most significant bit of a
      // 64-bit length to be zero, so a frame with it set is malformed — 1002 —
      // and not merely too big. Comparing against the cap first would classify
      // every such frame as 1009, which tells a peer its message was large when
      // the real answer is that its framing is wrong.
      if ((big & (1n << 63n)) !== 0n) {
        return fail(1002, "64-bit length with the high bit set");
      }
      if (big > BigInt(this.maxMessageBytes)) {
        return fail(1009, `frame length ${big} over the message cap`);
      }
      payloadLength = Number(big);
      offset = 10;
    }
    // Non-minimal length encodings (a 16-bit form holding 40) are accepted:
    // the value is bounded either way, and refusing them would break an app
    // over a detail no browser enforces.

    const isControl = (opcode & 0x8) !== 0;
    if (isControl) {
      // Control frames cannot be fragmented and cannot be large — they are
      // allowed to arrive BETWEEN the fragments of a data message, which is
      // exactly why they must be small and self-contained.
      if (!fin) return fail(1002, "fragmented control frame");
      if (payloadLength > MAX_CONTROL_PAYLOAD_BYTES) {
        return fail(1002, "control frame payload over 125 bytes");
      }
    } else if (payloadLength > this.maxMessageBytes) {
      return fail(1009, `frame length ${payloadLength} over the message cap`);
    } else if (opcode === OPCODE_CONTINUATION && this.fragmentOpcode !== null && this.fragmentBytes + payloadLength > this.maxMessageBytes) {
      // THE AGGREGATE CAP, CHECKED FROM THE HEADER. Waiting for the payload
      // first would mean buffering it to find out we do not want it: with a
      // near-cap message already retained, a continuation whose own length is
      // individually legal could still take the total to nearly twice the cap
      // before anything objected. The claim is refused as soon as it is
      // readable, so nothing is ever buffered on account of it.
      return fail(1009, `fragmented message would reach ${this.fragmentBytes + payloadLength} bytes, over the cap`);
    }

    if (buf.length < offset + payloadLength) return null;
    const payload = buf.subarray(offset, offset + payloadLength);
    this.buffer = buf.subarray(offset + payloadLength);

    switch (opcode) {
      case OPCODE_PING:
        return { ok: true, message: { kind: "ping", payload: copy(payload) } };
      case OPCODE_PONG:
        return { ok: true, message: { kind: "pong", payload: copy(payload) } };
      case OPCODE_CLOSE:
        return this.readClose(payload);
      case OPCODE_CONTINUATION:
        return this.readContinuation(payload, fin);
      case OPCODE_TEXT:
      case OPCODE_BINARY:
        return this.readDataStart(opcode, payload, fin);
      default:
        return fail(1002, `unknown opcode ${opcode}`);
    }
  }

  private readClose(payload: Buffer): { ok: true; message: DecodedMessage } | { ok: false; failure: DecodeFailure } {
    if (payload.length === 0) {
      return { ok: true, message: { kind: "close", code: null, reason: "" } };
    }
    // One byte cannot be a code, and there is no other thing it could be.
    if (payload.length === 1) return fail(1002, "close payload of one byte");
    const code = payload.readUInt16BE(0);
    if (!isTransmittableCloseCode(code)) {
      return fail(1002, `close code ${code} is not transmittable`);
    }
    const reason = decodeUtf8(payload.subarray(2));
    if (reason === null) return fail(1007, "close reason is not valid UTF-8");
    return { ok: true, message: { kind: "close", code, reason } };
  }

  private readDataStart(opcode: number, payload: Buffer, fin: boolean): { ok: true; message: DecodedMessage | null } | { ok: false; failure: DecodeFailure } {
    if (this.fragmentOpcode !== null) {
      return fail(1002, "new data frame while a message is unfinished");
    }
    if (fin) return this.completeMessage(opcode, copy(payload));
    this.fragmentOpcode = opcode;
    this.fragments = [copy(payload)];
    this.fragmentBytes = payload.length;
    return { ok: true, message: null };
  }

  private readContinuation(payload: Buffer, fin: boolean): { ok: true; message: DecodedMessage | null } | { ok: false; failure: DecodeFailure } {
    if (this.fragmentOpcode === null) {
      return fail(1002, "continuation with no message in progress");
    }
    // No aggregate check here: readFrame refuses an over-cap total from the
    // continuation's HEADER, before this payload was ever buffered. Repeating it
    // here would be a branch that cannot be reached and cannot be tested.
    this.fragments.push(copy(payload));
    this.fragmentBytes += payload.length;
    if (!fin) return { ok: true, message: null };
    const opcode = this.fragmentOpcode;
    const whole = Buffer.concat(this.fragments);
    this.fragments = [];
    this.fragmentBytes = 0;
    this.fragmentOpcode = null;
    return this.completeMessage(opcode, whole);
  }

  private completeMessage(opcode: number, payload: Buffer): { ok: true; message: DecodedMessage } | { ok: false; failure: DecodeFailure } {
    if (opcode === OPCODE_TEXT) {
      const text = decodeUtf8(payload);
      if (text === null) return fail(1007, "text frame is not valid UTF-8");
      return { ok: true, message: { kind: "text", text } };
    }
    return { ok: true, message: { kind: "binary", data: payload } };
  }
}

// A frame's payload is a VIEW into the read buffer, and the read buffer is
// reused and re-sliced as more bytes arrive. Anything kept past this turn is
// copied, so a message handed to the relay can never change under it.
function copy(view: Buffer): Buffer {
  return Buffer.from(view);
}

function fail(code: DecodeFailure["code"], detail: string): { ok: false; failure: DecodeFailure } {
  return { ok: false, failure: { code, detail } };
}
