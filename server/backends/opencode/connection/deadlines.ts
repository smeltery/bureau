import { BureauLogError } from "../../../../shared/i18n/backend-errors/error.ts";
import { logMessage } from "../../../../shared/i18n/log-message.ts";
export const OPENCODE_DEADLINE_MS = 30_000;

/** Bound headers and ordinary response bodies; SSE uses a per-read deadline. */
export async function fetchOpenCode(url: URL, init: RequestInit, timeoutMs = OPENCODE_DEADLINE_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new BureauLogError(logMessage("logs.backendError.timeout", { path: url.pathname }))), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal,
    });
    if (url.pathname === "/event" || !response.ok) return response;
    const body = await response.arrayBuffer();
    return new Response([204, 205, 304].includes(response.status) ? null : body, { status: response.status, headers: response.headers });
  } catch (error) {
    if (controller.signal.aborted && !init.signal?.aborted) throw controller.signal.reason;
    throw error;
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
        timer = setTimeout(() => reject(new BureauLogError(logMessage("logs.backendError.heartbeat"))), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
