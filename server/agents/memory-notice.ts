import { memoryStore, type MemoryScopeRef } from "../memory-store.ts";
import type { ManagedAgent } from "./state-types.ts";
import { rooms } from "./state.ts";

export const MEMORY_NOTICE_FILL_RATIO = 0.8;

export function formatMemoryNotice(
  measurements: readonly {
    label: string;
    contentChars: number;
    cap: number;
  }[],
): string | null {
  const full = measurements
    .map((m) => ({ label: m.label, fill: m.contentChars / m.cap }))
    .filter((m) => m.fill >= MEMORY_NOTICE_FILL_RATIO)
    .sort((a, b) => b.fill - a.fill);
  if (full.length === 0) return null;
  const listed = full
    .map((m) => (m.fill >= 1 ? `${m.label} at ${Math.round(m.fill * 100)}% (at or over its cap; saves to it fail until it is trimmed)` : `${m.label} at ${Math.round(m.fill * 100)}% of its cap`))
    .join(", ");
  return (
    `[memory check: auto-loaded memory is close to its size cap - ${listed}. ` +
    `Caps are hard: a save that would put a scope over its cap is refused. ` +
    `Offer the boss specific trims, applying them through the memory READ + PUT API after approval. ` +
    `Let the boss know they can also edit memory in Settings.]`
  );
}

export function memoryRefsFor(managed: ManagedAgent): MemoryScopeRef[] | null {
  const room = rooms[managed.info.room];
  if (!room) return null;
  return [
    { scope: "office", scopeId: null, label: "Office-wide" },
    { scope: "room", scopeId: room.id, label: `Room "${room.name}"` },
    ...(managed.info.userId ? [{ scope: "boss" as const, scopeId: managed.info.userId, label: "Your boss" }] : []),
    { scope: "agent", scopeId: managed.info.id, label: `Agent "${managed.info.name}"` },
  ];
}

export function armMemoryNotice(managed: ManagedAgent, refs = memoryRefsFor(managed)): void {
  managed.memoryNotice = managed.memoryNoticeFired || !refs ? null : formatMemoryNotice(memoryStore.measureForPromptMulti(refs));
}
