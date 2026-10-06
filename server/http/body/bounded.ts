export async function boundedBody(req: Request, limit = 256 * 1024): Promise<Buffer> {
  if (Number(req.headers.get("content-length")) > limit) throw new Error("body too large");
  if (!req.body) return Buffer.alloc(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void reader.cancel("body timed out");
  }, 10_000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("body too large");
      chunks.push(value);
    }
    if (timedOut) throw new Error("body timed out");
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timeout);
    await reader.cancel();
    reader.releaseLock();
  }
}
