import { Transform, type TransformCallback } from "node:stream";

export function secretPatterns(values: string[]): Buffer[] {
  const patterns = new Set<string>();
  for (const value of values.filter((value) => value.length >= 8)) {
    patterns.add(value);
    patterns.add(encodeURIComponent(value));
    const bytes = Buffer.from(value);
    patterns.add(bytes.toString("base64"));
    // Complete base64 groups remain recognizable when a secret is embedded in a larger value.
    for (let offset = 0; offset < 3; offset++) {
      const end = offset + Math.floor((bytes.length - offset) / 3) * 3;
      const core = bytes.subarray(offset, end).toString("base64");
      if (core.length >= 8) patterns.add(core);
    }
  }
  return [...patterns].map((value) => Buffer.from(value)).sort((a, b) => b.length - a.length);
}
export function scrubBuffer(input: Buffer, patterns: readonly Buffer[]): Buffer {
  let output = input;
  for (const pattern of patterns) {
    let index = output.indexOf(pattern);
    while (index >= 0) {
      output = Buffer.concat([output.subarray(0, index), Buffer.from("[redacted]"), output.subarray(index + pattern.length)]);
      index = output.indexOf(pattern, index + 10);
    }
  }
  return output;
}

/** Retain incomplete matches across transport chunks, without buffering entire downloads. */
export class SecretScrubber extends Transform {
  private pending = Buffer.alloc(0);
  private readonly overlap: number;
  constructor(private readonly patterns: readonly Buffer[]) {
    super();
    this.overlap = Math.max(0, ...patterns.map((pattern) => pattern.length - 1));
  }
  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.pending = Buffer.concat([this.pending, chunk]);
    let end = Math.max(0, this.pending.length - this.overlap);
    for (const pattern of this.patterns) {
      let index = this.pending.indexOf(pattern);
      while (index >= 0) {
        if (index < end && index + pattern.length > end) end = index;
        index = this.pending.indexOf(pattern, index + 1);
      }
    }
    if (end > 0) {
      this.push(scrubBuffer(this.pending.subarray(0, end), this.patterns));
      this.pending = this.pending.subarray(end);
    }
    callback();
  }
  override _flush(callback: TransformCallback): void {
    this.push(scrubBuffer(this.pending, this.patterns));
    callback();
  }
}
