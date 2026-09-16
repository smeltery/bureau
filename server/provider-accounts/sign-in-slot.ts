// Process-local "sign-in in progress" mutex per provider.
//
// Bureau does not yet run shared browser/device OAuth login slots. Connections
// only shows host CLI guidance (and API-key paste). This mutex lets a member
// mark that they are following that guidance so a second member sees who holds
// the slot — holder name + start time on the wire; sentence composition stays
// on the client. Full OAuth / device-code login remains deferred.
//
// Slots are in-memory only (lost on process restart). Idle deadline matches
// the ten-minute window used elsewhere for interactive provider login.

import type { ProviderAccountProvider, ProviderLoginQueueWire } from "../../shared/provider-accounts.ts";
import { getUserById } from "../users.ts";

export const SIGN_IN_SLOT_TTL_MS = 10 * 60_000;

export type SignInSlot = {
  userId: string;
  holderName: string;
  startedAt: number;
  provider: ProviderAccountProvider;
};

const slots = new Map<ProviderAccountProvider, SignInSlot>();

function expired(slot: SignInSlot, now = Date.now()): boolean {
  return now - slot.startedAt >= SIGN_IN_SLOT_TTL_MS;
}

function purgeIfExpired(provider: ProviderAccountProvider, now = Date.now()): void {
  const slot = slots.get(provider);
  if (slot && expired(slot, now)) slots.delete(provider);
}

export function peekSignInSlot(provider: ProviderAccountProvider, now = Date.now()): SignInSlot | null {
  purgeIfExpired(provider, now);
  return slots.get(provider) ?? null;
}

export function loginQueueOf(provider: ProviderAccountProvider, now = Date.now()): ProviderLoginQueueWire | undefined {
  const slot = peekSignInSlot(provider, now);
  if (!slot) return undefined;
  return { holderName: slot.holderName, startedAt: slot.startedAt };
}

export type AcquireSignInSlotResult = { ok: true; slot: SignInSlot } | { ok: false; code: "shared_login_in_progress"; detail: ProviderLoginQueueWire };

export function acquireSignInSlot(userId: string, provider: ProviderAccountProvider, now = Date.now()): AcquireSignInSlotResult {
  purgeIfExpired(provider, now);
  const existing = slots.get(provider);
  if (existing && existing.userId !== userId) {
    return {
      ok: false,
      code: "shared_login_in_progress",
      detail: { holderName: existing.holderName, startedAt: existing.startedAt },
    };
  }
  if (existing && existing.userId === userId) {
    return { ok: true, slot: existing };
  }
  const holderName = getUserById(userId)?.name ?? userId;
  const slot: SignInSlot = { userId, holderName, startedAt: now, provider };
  slots.set(provider, slot);
  return { ok: true, slot };
}

/** Release a slot. Holder always can; `allowForeign` lets an owner cancel another's. */
export function releaseSignInSlot(userId: string, provider: ProviderAccountProvider, allowForeign = false): boolean {
  purgeIfExpired(provider);
  const active = slots.get(provider);
  if (!active) return false;
  if (active.userId !== userId && !allowForeign) return false;
  slots.delete(provider);
  return true;
}

/** Test helper — clear every slot. */
export function resetSignInSlotsForTests(): void {
  slots.clear();
}
