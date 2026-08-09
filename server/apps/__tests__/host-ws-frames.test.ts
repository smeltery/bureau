// The frame codec: what the relay puts on the wire, and what it reads back off
// it.
//
// The relay decodes bytes an APP wrote, and an app is code an agent produced in
// a scratch directory — so every test here is really one question: can a peer
// make the parser allocate, mis-frame, or accept something it should refuse?

import { describe, expect, it } from "bun:test";
import {
  MAX_CLOSE_REASON_BYTES,
  OPCODE_BINARY,
  OPCODE_CLOSE,
  OPCODE_PING,
  OPCODE_PONG,
  OPCODE_TEXT,
  encodeBinaryFrame,
  encodeCloseFrame,
  encodePingFrame,
  encodePongFrame,
  encodeTextFrame,
  isTransmittableCloseCode,
  truncateCloseReason,
} from "../host/ws-frames.ts";
import { collect, decoder, serverFrame, u16 } from "./host-ws-frames-kit.ts";

describe("host-ws-frames: encoding", () => {
  it("masks every frame with a fresh key and round-trips the payload", () => {
    const a = encodeTextFrame("hello");
    const b = encodeTextFrame("hello");
    // Same payload, different bytes on the wire: the mask is per frame. (A
    // fixed mask would still decode, which is why this is asserted rather than
    // assumed.)
    expect(a.equals(b)).toBe(false);
    // FIN + text opcode, mask bit set, 5-byte payload.
    expect(a[0]).toBe(0x81);
    expect(a[1]).toBe(0x85);
    const mask = a.subarray(2, 6);
    const unmasked = Buffer.from(a.subarray(6));
    for (let i = 0; i < unmasked.length; i++) unmasked[i] ^= mask[i & 3];
    expect(unmasked.toString()).toBe("hello");
  });

  it("does not mutate the caller's buffer while masking", () => {
    // The relay hands this the browser's own inbound frame. Masking in place
    // would corrupt the bytes being relayed.
    const payload = Buffer.from([1, 2, 3, 4, 5]);
    const before = Buffer.from(payload);
    encodeBinaryFrame(payload);
    expect(payload.equals(before)).toBe(true);
  });

  it("uses the length form the size calls for", () => {
    expect(encodeTextFrame("x")[1] & 0x7f).toBe(1);
    expect(encodeBinaryFrame(Buffer.alloc(200))[1] & 0x7f).toBe(126);
    expect(encodeBinaryFrame(Buffer.alloc(70_000))[1] & 0x7f).toBe(127);
    // 16-bit form: the length sits in the two bytes after the framing.
    expect(encodeBinaryFrame(Buffer.alloc(200)).readUInt16BE(2)).toBe(200);
    expect(Number(encodeBinaryFrame(Buffer.alloc(70_000)).readBigUInt64BE(2))).toBe(70_000);
  });

  it("writes ping and pong as masked control frames", () => {
    const ping = encodePingFrame(Buffer.from("keep"));
    const pong = encodePongFrame(Buffer.from("keep"));
    expect(ping[0]).toBe(0x80 | OPCODE_PING);
    expect(pong[0]).toBe(0x80 | OPCODE_PONG);
    // Masked (a client always masks) and 4 bytes of payload.
    expect(ping[1]).toBe(0x84);
    expect(pong[1]).toBe(0x84);
    // A pong carries the ping's payload back verbatim — the whole point of
    // answering one, and the only way a peer can attribute it.
    const mask = pong.subarray(2, 6);
    const unmasked = Buffer.from(pong.subarray(6));
    for (let i = 0; i < unmasked.length; i++) unmasked[i] ^= mask[i & 3];
    expect(unmasked.toString()).toBe("keep");
  });

  it("writes a close with a code, and an empty payload for no status", () => {
    const withCode = encodeCloseFrame(4321, "bye");
    expect(withCode[1] & 0x7f).toBe(2 + 3);
    const noStatus = encodeCloseFrame(null, "ignored");
    // No code means no reason either — a reason cannot travel without one.
    expect(noStatus[1] & 0x7f).toBe(0);
  });
});

describe("host-ws-frames: close codes and reasons", () => {
  it("accepts only codes that may appear on the wire", () => {
    for (const code of [1000, 1001, 1002, 1003, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014, 3000, 3999, 4000, 4999]) {
      expect(isTransmittableCloseCode(code)).toBe(true);
    }
    // 1004 was never assigned; 1005/1006 describe a LOCAL condition and cannot
    // be sent; 1015 is the TLS-failure code and is equally local. The rest are
    // outside the grammar.
    for (const code of [0, 999, 1004, 1005, 1006, 1015, 1016, 2000, 2999, 5000, -1, 1.5, NaN]) {
      expect(isTransmittableCloseCode(code)).toBe(false);
    }
  });

  it("truncates a reason on a code-point boundary, not a byte", () => {
    // Bun cuts a long reason blindly at 123 bytes, which can land inside a
    // multi-byte character and put invalid UTF-8 on the wire.
    const euro = "€"; // 3 bytes
    const long = euro.repeat(60); // 180 bytes
    const cut = truncateCloseReason(long);
    const bytes = Buffer.from(cut, "utf8");
    expect(bytes.length).toBeLessThanOrEqual(MAX_CLOSE_REASON_BYTES);
    // Every character survived whole: 41 euros is 123 bytes exactly.
    expect(cut).toBe(euro.repeat(41));
    expect(Buffer.from(cut, "utf8").toString("utf8")).toBe(cut);
  });

  it("leaves a reason that already fits alone, including at the boundary", () => {
    const exact = "a".repeat(MAX_CLOSE_REASON_BYTES);
    expect(truncateCloseReason(exact)).toBe(exact);
    expect(truncateCloseReason("")).toBe("");
    // One byte over, single-byte characters: the last one goes.
    const over = "a".repeat(MAX_CLOSE_REASON_BYTES + 1);
    expect(truncateCloseReason(over)).toBe(exact);
  });

  it("cuts a 4-byte character cleanly", () => {
    // An emoji is 4 bytes; a blind cut at 123 would leave one to three orphans.
    const emoji = "\u{1f600}";
    const long = emoji.repeat(40); // 160 bytes
    const cut = truncateCloseReason(long);
    expect(Buffer.from(cut, "utf8").length).toBe(120);
    expect(cut).toBe(emoji.repeat(30));
  });
});

describe("host-ws-frames: decoding whole frames", () => {
  it("reads text, binary, ping, pong and close", () => {
    const dec = decoder();
    const stream = Buffer.concat([
      serverFrame(OPCODE_TEXT, "hi"),
      serverFrame(OPCODE_BINARY, Buffer.from([0, 255, 7])),
      serverFrame(OPCODE_PING, "p"),
      serverFrame(OPCODE_PONG, "q"),
      serverFrame(OPCODE_CLOSE, Buffer.concat([u16(4321), Buffer.from("bye")])),
    ]);
    expect(collect(dec, stream)).toEqual([
      { kind: "text", text: "hi" },
      { kind: "binary", data: Buffer.from([0, 255, 7]) },
      { kind: "ping", payload: Buffer.from("p") },
      { kind: "pong", payload: Buffer.from("q") },
      { kind: "close", code: 4321, reason: "bye" },
    ]);
  });

  it("reads a close with no status as a null code", () => {
    const dec = decoder();
    expect(collect(dec, serverFrame(OPCODE_CLOSE, Buffer.alloc(0)))).toEqual([{ kind: "close", code: null, reason: "" }]);
  });

  it("accepts every length form, including a non-minimal one", () => {
    // A peer that writes a 40-byte payload with the 64-bit length form is being
    // wasteful, not hostile, and the value is bounded either way.
    const dec = decoder();
    const body = Buffer.alloc(40, 9);
    const got = collect(dec, Buffer.concat([serverFrame(OPCODE_BINARY, body, { lengthForm: 16 }), serverFrame(OPCODE_BINARY, body, { lengthForm: 64 })]));
    expect(got).toEqual([
      { kind: "binary", data: body },
      { kind: "binary", data: body },
    ]);
  });

  it("copies payloads out of the read buffer", () => {
    // The decoder slices views out of a buffer it keeps re-slicing. A message
    // that still pointed into it could change after being handed over.
    const dec = decoder();
    const chunk = Buffer.concat([serverFrame(OPCODE_BINARY, Buffer.from([1, 2, 3]))]);
    const got = collect(dec, chunk);
    chunk.fill(0);
    expect(got).toEqual([{ kind: "binary", data: Buffer.from([1, 2, 3]) }]);
  });
});
