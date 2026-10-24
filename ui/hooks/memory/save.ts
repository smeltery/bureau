import type { SettingsFailure } from "../settings/feedback.ts";
import type { MemoryScope } from "../../../shared/types.ts";

export type MemorySaveResult = { ok: true; version: string } | { ok: false; conflict?: boolean; message: string; feedback?: SettingsFailure };
type MemoryWrite = { scope: MemoryScope; scopeId: string | null; text: string; version: string };

export async function saveMemory(write: MemoryWrite, url = "/api/memory", timeoutMs = 30_000): Promise<MemorySaveResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "PUT",
      signal: controller.signal,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(write),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const conflict = body?.error?.code === "memory_conflict";
      const detail = body?.error?.message;
      return {
        ok: false,
        conflict,
        feedback: conflict ? { key: "settingsUi.memoryConflict" } : typeof detail === "string" && detail.trim() ? detail : { memoryStatus: response.status },
        message: conflict
          ? "Memory changed since you opened this. Reopen the dialog to edit the latest version."
          : typeof detail === "string" && detail.trim()
            ? detail
            : `Could not save memory (HTTP ${response.status}). Your edits are still available.`,
      };
    }
    const body = await response.json();
    if (typeof body?.version !== "string" || !body.version) {
      return {
        ok: false,
        feedback: { key: "settingsUi.memoryInvalid" },
        message: "The memory save response was invalid. Your edits are still available; reopen the dialog to check the saved version.",
      };
    }
    return { ok: true, version: body.version };
  } catch {
    return { ok: false, feedback: { key: "settingsUi.memoryUnconfirmed" }, message: "Could not confirm the memory save. Your edits are still available; check your connection and try again." };
  } finally {
    clearTimeout(timeout);
  }
}
