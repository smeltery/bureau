// Hand-built wire bytes for the codec's tests.
//
// SERVER-to-client frames are built here rather than taken from the encoder, so
// the tests do not prove the codec self-consistent — they prove it right about
// the wire.

import { FrameDecoder, type DecodeResult, type DecodedMessage } from "../host/ws-decoder.ts";

export function serverFrame(opcode: number, payload: Buffer | string, opts: { fin?: boolean; rsv?: number; mask?: boolean; lengthForm?: 7 | 16 | 64 } = {}): Buffer {
  const body = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  const fin = opts.fin ?? true;
  const len = body.length;
  const form = opts.lengthForm ?? (len < 126 ? 7 : len < 0x10000 ? 16 : 64);
  const maskBit = opts.mask ? 0x80 : 0;
  let header: Buffer;
  if (form === 7) {
    header = Buffer.alloc(2);
    header[1] = maskBit | len;
  } else if (form === 16) {
    header = Buffer.alloc(4);
    header[1] = maskBit | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = maskBit | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = (fin ? 0x80 : 0) | ((opts.rsv ?? 0) << 4) | opcode;
  if (!opts.mask) return Buffer.concat([header, body]);
  const mask = Buffer.from([1, 2, 3, 4]);
  const masked = Buffer.from(body);
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}

// A 64-bit length header whose length field is a raw value — so a length no
// buffer could hold can be put on the wire without allocating it.
export function hugeLengthFrame(opcode: number, claimed: bigint): Buffer {
  const header = Buffer.alloc(10);
  header[0] = 0x80 | opcode;
  header[1] = 127;
  header.writeBigUInt64BE(claimed, 2);
  return header;
}

export function decoder(maxMessageBytes = 1024): FrameDecoder {
  return new FrameDecoder({ maxMessageBytes });
}

// Feed bytes and collect whatever they produced. The decoder delivers each
// message through a callback rather than returning a batch (so only one decoded
// message is ever in hand), and the tests keep asserting on lists — so the
// collection happens here, once.
export function pushAll(dec: FrameDecoder, bytes: Buffer): DecodeResult {
  return dec.push(bytes, () => "continue");
}

export function collect(dec: FrameDecoder, bytes: Buffer): DecodedMessage[] {
  const out: DecodedMessage[] = [];
  const result = dec.push(bytes, (message) => {
    out.push(message);
    return "continue";
  });
  if (!result.ok) throw new Error(`decode failed: ${result.failure.detail}`);
  return out;
}

export function u16(value: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(value, 0);
  return b;
}
