export class VoiceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export async function readVoiceBytes(body: ReadableStream<Uint8Array> | null, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!body) throw new VoiceError("Missing body.");
  const reader = body.getReader();
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    signal.throwIfAborted();
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new VoiceError("Voice request or response is too large.", 413);
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
