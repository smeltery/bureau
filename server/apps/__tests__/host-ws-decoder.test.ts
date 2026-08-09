// The decoder against a peer that is untrusted and a transport that is
// arbitrary: fragmentation, everything a peer must not send, and the same corpus
// split at every byte boundary.
//
// The byte-split cases exist because TCP has no idea what a frame is: the same
// stream arrives as one read on loopback and as fifty reads through anything
// real, and a parser that only works on the first shape is a parser that fails
// in production.

import { describe, expect, it } from "bun:test";
import type { DecodedMessage } from "../host/ws-decoder.ts";
import { OPCODE_BINARY, OPCODE_CLOSE, OPCODE_CONTINUATION, OPCODE_PING, OPCODE_TEXT } from "../host/ws-frames.ts";
import { collect, decoder, hugeLengthFrame, pushAll, serverFrame, u16 } from "./host-ws-frames-kit.ts";

describe("host-ws-decoder: fragmentation", () => {
  it("reassembles a fragmented text message", () => {
    const dec = decoder();
    const got = collect(dec, Buffer.concat([serverFrame(OPCODE_TEXT, "he", { fin: false }), serverFrame(OPCODE_CONTINUATION, "ll", { fin: false }), serverFrame(OPCODE_CONTINUATION, "o")]));
    expect(got).toEqual([{ kind: "text", text: "hello" }]);
  });

  it("lets a control frame interleave with the fragments", () => {
    // Legal, and the reason control frames must be small and unfragmented: a
    // ping has to be answerable while a big message is still arriving.
    const dec = decoder();
    const got = collect(dec, Buffer.concat([serverFrame(OPCODE_BINARY, Buffer.from([1]), { fin: false }), serverFrame(OPCODE_PING, "mid"), serverFrame(OPCODE_CONTINUATION, Buffer.from([2]))]));
    expect(got).toEqual([
      { kind: "ping", payload: Buffer.from("mid") },
      { kind: "binary", data: Buffer.from([1, 2]) },
    ]);
  });

  it("validates UTF-8 across the whole reassembled message, not per fragment", () => {
    // A 3-byte character split across two fragments is VALID text, and a
    // decoder that validated each fragment would reject it.
    const euro = Buffer.from("€", "utf8");
    const dec = decoder();
    const got = collect(dec, Buffer.concat([serverFrame(OPCODE_TEXT, euro.subarray(0, 1), { fin: false }), serverFrame(OPCODE_CONTINUATION, euro.subarray(1))]));
    expect(got).toEqual([{ kind: "text", text: "€" }]);
  });

  it("refuses a continuation with no message in progress", () => {
    const res = pushAll(decoder(), serverFrame(OPCODE_CONTINUATION, "x"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure.code).toBe(1002);
  });

  it("refuses a new data frame while a message is unfinished", () => {
    const res = pushAll(decoder(), Buffer.concat([serverFrame(OPCODE_TEXT, "a", { fin: false }), serverFrame(OPCODE_TEXT, "b")]));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure.code).toBe(1002);
  });
});

describe("host-ws-decoder: refusing what a peer must not send", () => {
  const cases: { name: string; bytes: Buffer; code: 1002 | 1007 | 1009 }[] = [
    { name: "a reserved bit with no extension negotiated", bytes: serverFrame(OPCODE_TEXT, "x", { rsv: 0b100 }), code: 1002 },
    { name: "a masked server frame", bytes: serverFrame(OPCODE_TEXT, "x", { mask: true }), code: 1002 },
    { name: "an unknown opcode", bytes: serverFrame(0x3, "x"), code: 1002 },
    { name: "a fragmented control frame", bytes: serverFrame(OPCODE_PING, "x", { fin: false }), code: 1002 },
    { name: "a control frame over 125 bytes", bytes: serverFrame(OPCODE_PING, Buffer.alloc(126)), code: 1002 },
    { name: "a close payload of one byte", bytes: serverFrame(OPCODE_CLOSE, Buffer.from([3])), code: 1002 },
    { name: "a close code that cannot be transmitted", bytes: serverFrame(OPCODE_CLOSE, u16(1006)), code: 1002 },
    { name: "a close reason that is not UTF-8", bytes: serverFrame(OPCODE_CLOSE, Buffer.concat([u16(1000), Buffer.from([0xff, 0xfe])])), code: 1007 },
    { name: "a text frame that is not UTF-8", bytes: serverFrame(OPCODE_TEXT, Buffer.from([0xc3, 0x28])), code: 1007 },
    { name: "a lone continuation byte as text", bytes: serverFrame(OPCODE_TEXT, Buffer.from([0x80])), code: 1007 },
    { name: "a frame larger than the message cap", bytes: serverFrame(OPCODE_BINARY, Buffer.alloc(1025)), code: 1009 },
  ];
  for (const c of cases) {
    it(`refuses ${c.name}`, () => {
      const res = pushAll(decoder(1024), c.bytes);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.failure.code).toBe(c.code);
    });
  }

  it("refuses a 64-bit length over the cap without allocating for it", () => {
    // The header alone, claiming 2^62 bytes. Compared as a BigInt: converting to
    // a Number first loses precision above 2^53, and a length that compares as
    // something smaller than it is is exactly how a parser gets talked into an
    // allocation.
    const res = pushAll(decoder(1024), hugeLengthFrame(OPCODE_BINARY, 1n << 62n));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.failure.code).toBe(1009);
  });

  it("calls a 64-bit length with the high bit set MALFORMED, not oversized", () => {
    // The RFC requires that bit to be zero, so this is a framing error (1002).
    // Answering 1009 would tell the peer its message was too big when the real
    // problem is that its length field is not a length at all.
    const res = pushAll(decoder(1024), hugeLengthFrame(OPCODE_BINARY, 0xffffffffffffffffn));
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.failure.code).toBe(1002);
      expect(res.failure.detail).toContain("high bit");
    }
  });

  it("refuses an over-cap aggregate from the continuation HEADER, before its payload", () => {
    // The bound has to bite on the CLAIM, not on the delivered bytes. With 900
    // bytes already retained under a 1024-byte cap, a continuation announcing
    // another 900 is individually legal — so a decoder that waited for the
    // payload would buffer it and only then object, holding nearly twice the cap.
    const dec = decoder(1024);
    const first = pushAll(dec, serverFrame(OPCODE_BINARY, Buffer.alloc(900), { fin: false }));
    expect(first.ok).toBe(true);
    expect(dec.pendingBytes()).toBe(900);
    // ONLY the header of the continuation: 4 bytes announcing 900 more.
    const header = Buffer.alloc(4);
    header[0] = 0x80 | OPCODE_CONTINUATION;
    header[1] = 126;
    header.writeUInt16BE(900, 2);
    const second = pushAll(dec, header);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.failure.code).toBe(1009);
      expect(second.failure.detail).toContain("over the cap");
    }
  });

  it("still accepts a fragmented message whose aggregate fits exactly", () => {
    const dec = decoder(1024);
    expect(collect(dec, Buffer.concat([serverFrame(OPCODE_BINARY, Buffer.alloc(1000, 1), { fin: false }), serverFrame(OPCODE_CONTINUATION, Buffer.alloc(24, 2))]))).toEqual([
      { kind: "binary", data: Buffer.concat([Buffer.alloc(1000, 1), Buffer.alloc(24, 2)]) },
    ]);
  });

  it("refuses a fragmented message that walks past the cap in small steps", () => {
    const dec = decoder(1024);
    const first = pushAll(dec, serverFrame(OPCODE_BINARY, Buffer.alloc(600), { fin: false }));
    expect(first.ok).toBe(true);
    const second = pushAll(dec, serverFrame(OPCODE_CONTINUATION, Buffer.alloc(600)));
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.failure.code).toBe(1009);
  });

  it("accepts a message exactly at the cap", () => {
    const dec = decoder(1024);
    expect(collect(dec, serverFrame(OPCODE_BINARY, Buffer.alloc(1024, 3)))).toEqual([{ kind: "binary", data: Buffer.alloc(1024, 3) }]);
  });

  it("is spent after a failure and refuses further input", () => {
    const dec = decoder();
    expect(pushAll(dec, serverFrame(0x3, "x")).ok).toBe(false);
    // Even a perfectly good frame: the stream's framing is no longer known to be
    // where we think it is.
    const after = pushAll(dec, serverFrame(OPCODE_TEXT, "fine"));
    expect(after.ok).toBe(false);
  });
});

describe("host-ws-decoder: TCP does not respect frame boundaries", () => {
  // One stream holding every shape that matters: short and 16-bit lengths, a
  // fragmented message, an interleaved control frame, a close at the end.
  const corpus = Buffer.concat([
    serverFrame(OPCODE_TEXT, "first"),
    serverFrame(OPCODE_BINARY, Buffer.alloc(300, 7), { lengthForm: 16 }),
    serverFrame(OPCODE_TEXT, "frag-", { fin: false }),
    serverFrame(OPCODE_PING, "mid"),
    serverFrame(OPCODE_CONTINUATION, "ment"),
    serverFrame(OPCODE_CLOSE, Buffer.concat([u16(1001), Buffer.from("done")])),
  ]);
  const expected: DecodedMessage[] = [
    { kind: "text", text: "first" },
    { kind: "binary", data: Buffer.alloc(300, 7) },
    { kind: "ping", payload: Buffer.from("mid") },
    { kind: "text", text: "frag-ment" },
    { kind: "close", code: 1001, reason: "done" },
  ];

  it("decodes the same messages from a single read", () => {
    expect(collect(decoder(4096), corpus)).toEqual(expected);
  });

  it("decodes the same messages split at EVERY byte boundary", () => {
    for (let cut = 1; cut < corpus.length; cut++) {
      const dec = decoder(4096);
      const got: DecodedMessage[] = [];
      for (const part of [corpus.subarray(0, cut), corpus.subarray(cut)]) {
        got.push(...collect(dec, Buffer.from(part)));
      }
      expect({ cut, got }).toEqual({ cut, got: expected });
    }
  });

  it("decodes the same messages one byte at a time", () => {
    const dec = decoder(4096);
    const got: DecodedMessage[] = [];
    for (const byte of corpus) {
      got.push(...collect(dec, Buffer.from([byte])));
    }
    expect(got).toEqual(expected);
  });

  it("keeps ONE decoded message in hand, not a whole read's worth", () => {
    // 200 frames in a single chunk. Because delivery is incremental, the decoder
    // is never holding the batch: after each message is handed over, the only
    // bytes it still owns are the ones it has not parsed yet — and by the end,
    // none. A decoder that returned an array instead would be retaining all 200
    // payloads at once, which is the accounting hole this shape closes.
    const dec = decoder(4096);
    const frames: Buffer[] = [];
    for (let i = 0; i < 200; i++) {
      frames.push(serverFrame(OPCODE_BINARY, Buffer.alloc(1024, i & 0xff)));
    }
    let seen = 0;
    let peakPending = 0;
    const result = dec.push(Buffer.concat(frames), () => {
      seen++;
      peakPending = Math.max(peakPending, dec.pendingBytes());
      return "continue";
    });
    expect(result.ok).toBe(true);
    expect(seen).toBe(200);
    expect(dec.pendingBytes()).toBe(0);
    // While delivering, what is still held is only the unparsed tail — which
    // shrinks. It is bounded by the chunk, never multiplied by it.
    expect(peakPending).toBeLessThanOrEqual(200 * (1024 + 4));
  });

  it("stops parsing the moment a handler says so", () => {
    // The relay says "stop" when a message closed the connection. What is left in
    // the buffer stays accounted for rather than being parsed into messages
    // nobody will read.
    const dec = decoder(4096);
    const stream = Buffer.concat([serverFrame(OPCODE_TEXT, "one"), serverFrame(OPCODE_TEXT, "two"), serverFrame(OPCODE_TEXT, "three")]);
    const seen: string[] = [];
    const result = dec.push(stream, (message) => {
      if (message.kind === "text") seen.push(message.text);
      return seen.length === 2 ? "stop" : "continue";
    });
    expect(result).toEqual({ ok: true, stopped: true });
    expect(seen).toEqual(["one", "two"]);
    expect(dec.pendingBytes()).toBe(serverFrame(OPCODE_TEXT, "three").length);
  });

  it("holds no more than the bytes it has been given", () => {
    // Half of a big frame's header, then nothing: the decoder must be waiting on
    // bytes, not sizing a buffer for the length it was promised.
    const dec = decoder(1024 * 1024);
    pushAll(dec, Buffer.from([0x82, 0x7f, 0, 0, 0, 0]));
    expect(dec.pendingBytes()).toBe(6);
    // A complete but unfinished fragment is accounted too.
    const dec2 = decoder(1024 * 1024);
    pushAll(dec2, serverFrame(OPCODE_BINARY, Buffer.alloc(500), { fin: false }));
    expect(dec2.pendingBytes()).toBe(500);
  });
});
