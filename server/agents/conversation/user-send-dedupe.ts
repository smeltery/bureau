export type UserSendAcceptance = { ok: true } | { ok: false; status: number; error: string };

export const USER_SEND_DEDUPE_MAX_PER_AGENT = 500;
export const USER_SEND_DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;

type Slot = { kind: "accepted"; at: number } | { kind: "in_flight"; at: number; waiters: Array<(result: UserSendAcceptance) => void> };

export type DedupeClaim = { kind: "new"; settle: (result: UserSendAcceptance) => void } | { kind: "accepted" } | { kind: "in_flight"; wait: Promise<UserSendAcceptance> };

export function createUserSendDedupe(opts: { maxPerAgent?: number; ttlMs?: number; now?: () => number } = {}) {
  const maxPerAgent = opts.maxPerAgent ?? USER_SEND_DEDUPE_MAX_PER_AGENT;
  const ttlMs = opts.ttlMs ?? USER_SEND_DEDUPE_TTL_MS;
  const now = opts.now ?? Date.now;
  const byAgent = new Map<string, Map<string, Slot>>();

  function prune(slots: Map<string, Slot>) {
    const cutoff = now() - ttlMs;
    for (const [key, slot] of slots) {
      if (slots.size <= maxPerAgent && slot.at >= cutoff) break;
      if (slot.kind === "accepted") slots.delete(key);
    }
  }

  return {
    claim(agentId: string, key: string): DedupeClaim {
      let slots = byAgent.get(agentId);
      if (!slots) {
        slots = new Map();
        byAgent.set(agentId, slots);
      }
      prune(slots);
      const prior = slots.get(key);
      if (prior?.kind === "accepted") return { kind: "accepted" };
      if (prior?.kind === "in_flight") return { kind: "in_flight", wait: new Promise((resolve) => prior.waiters.push(resolve)) };
      const slot: Slot = { kind: "in_flight", at: now(), waiters: [] };
      slots.set(key, slot);
      let settled = false;
      return {
        kind: "new",
        settle(result: UserSendAcceptance) {
          if (settled) return;
          settled = true;
          if (slots.get(key) === slot) {
            if (result.ok) slots.set(key, { kind: "accepted", at: now() });
            else slots.delete(key);
          }
          for (const resolve of slot.waiters) resolve(result);
        },
      };
    },
    forgetAgent(agentId: string): void {
      byAgent.delete(agentId);
    },
  };
}
