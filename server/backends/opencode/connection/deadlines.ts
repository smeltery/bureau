export const OPENCODE_DEADLINE_MS = 30_000;

/** Bound headers and ordinary response bodies; SSE uses a per-read deadline. */
export async function fetchOpenCode(url: URL, init: RequestInit, timeoutMs = OPENCODE_DEADLINE_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`OpenCode request timed out at ${url.pathname}.`)), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal,
    });
    if (url.pathname === "/event" || !response.ok) return response;
    const body = await response.arrayBuffer();
    return new Response([204, 205, 304].includes(response.status) ? null : body, { status: response.status, headers: response.headers });
  } finally {
    clearTimeout(timer);
  }
}

export async function readOpenCodeEvent(reader: ReadableStreamDefaultReader<Uint8Array>, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("OpenCode event stream stopped sending heartbeats.")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
