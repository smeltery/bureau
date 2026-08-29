import type { ManagedAgent } from "../state.ts";

// How long a delivered clientMessageId stays reserved on the receiver so a
// sender retry (timeout, flaky network) does not deliver a duplicate turn.
export const QUEUE_DEDUPE_TTL_MS = 5 * 60_000;

export type QueueDedupeEntry = { expiresAt: number; messageId: string };

export function recordQueueDedupe(managed: ManagedAgent, clientMessageId: string, messageId: string) {
  const now = Date.now();
  // Lazy prune only when the map has grown past a small threshold so the
  // common (small) case stays O(1).
  if (managed.queueDedupe.size > 100) {
    for (const [key, entry] of managed.queueDedupe) {
      if (entry.expiresAt < now) managed.queueDedupe.delete(key);
    }
  }
  managed.queueDedupe.set(clientMessageId, { expiresAt: now + QUEUE_DEDUPE_TTL_MS, messageId });
}

export function lookupQueueDedupe(managed: ManagedAgent, clientMessageId: string): QueueDedupeEntry | null {
  const entry = managed.queueDedupe.get(clientMessageId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    managed.queueDedupe.delete(clientMessageId);
    return null;
  }
  return entry;
}

/** Persistable view: clientMessageId → expiry epoch ms. */
export function queueDedupeForPersist(managed: ManagedAgent): Record<string, number> {
  const now = Date.now();
  const out: Record<string, number> = {};
  for (const [id, entry] of managed.queueDedupe) {
    if (entry.expiresAt > now) out[id] = entry.expiresAt;
  }
  return out;
}

export function queueDedupeFromPersist(raw: Record<string, number> | undefined): Map<string, QueueDedupeEntry> {
  const now = Date.now();
  const map = new Map<string, QueueDedupeEntry>();
  if (!raw || typeof raw !== "object") return map;
  for (const [id, expiresAt] of Object.entries(raw)) {
    if (typeof expiresAt === "number" && expiresAt > now) {
      // messageId is only needed for live ack shape; after restart a stable
      // empty id is fine — the reservation itself is what matters.
      map.set(id, { expiresAt, messageId: "" });
    }
  }
  return map;
}
