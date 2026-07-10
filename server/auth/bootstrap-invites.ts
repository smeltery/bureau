import { inviteStore, persistInvites, type StoredInvite } from "./store.ts";

// Mark every still-unconsumed bootstrap invite as consumed. Called after a
// successful bootstrap accept (siblings are now stale) and when an accept is
// refused because an owner exists (the invite itself is stale).
export function markAllUnconsumedBootstrapInvitesConsumed(): void {
  const stale: StoredInvite[] = [];
  for (const inv of inviteStore().values()) {
    if (inv.bootstrap && !inv.consumed) stale.push(inv);
  }
  if (stale.length === 0) return;
  const now = Date.now();
  for (const inv of stale) {
    inv.consumed = true;
    inv.consumedAt = now;
  }
  try {
    persistInvites();
  } catch (err) {
    for (const inv of stale) {
      inv.consumed = false;
      inv.consumedAt = null;
    }
    console.error(`[auth] failed to sweep ${stale.length} stale bootstrap invite(s); they will be retried on the next owner-creating accept`, err);
  }
}
