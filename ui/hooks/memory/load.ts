import type { SettingsFailure } from "../settings/feedback.ts";

type MemoryData = { text: string; version: string; cap: number };
export type MemoryLoadResult = { ok: true; data: MemoryData } | { ok: false; feedback: SettingsFailure };

export async function loadMemory(url: string, signal?: AbortSignal, timeoutMs = 30_000): Promise<MemoryLoadResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(url, { credentials: "same-origin", signal: controller.signal });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const detail = body?.error?.message;
      return { ok: false, feedback: typeof detail === "string" && detail.trim() ? detail : { memoryLoadStatus: response.status } };
    }
    const data = await response.json();
    if (typeof data?.text !== "string" || typeof data?.version !== "string" || !data.version || !Number.isSafeInteger(data?.cap) || data.cap < 0) {
      return { ok: false, feedback: { key: "settingsUi.memoryLoadInvalid" } };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, feedback: { key: "settingsUi.memoryLoadFailed" } };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
