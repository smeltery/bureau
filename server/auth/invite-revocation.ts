import { lowercaseKey } from "../../shared/identity.ts";
import { ensureLoaded, inviteStore, mutate, persistInvites } from "./store.ts";

export type RevokeResult = "ok" | "not_found" | "ambiguous";

// Find at most two matching rows; if more than one matches the same display
// prefix we refuse to revoke either, so an extremely unlikely 8-char prefix
// collision can't silently target the wrong record.
export async function revokeInviteByPrefix(prefix: string): Promise<RevokeResult> {
  return mutate(() => {
    ensureLoaded();
    const matches: string[] = [];
    for (const [k, v] of inviteStore()) {
      if (v.tokenPrefix === prefix) matches.push(k);
      if (matches.length > 1) break;
    }
    if (matches.length === 0) return "not_found";
    if (matches.length > 1) return "ambiguous";
    const k = matches[0];
    const prev = inviteStore().get(k)!;
    inviteStore().delete(k);
    try {
      persistInvites();
    } catch (err) {
      inviteStore().set(k, prev);
      throw err;
    }
    return "ok";
  });
}

export async function revokeOutstandingInviteByPrefixForUsername(prefix: string, username: string): Promise<RevokeResult> {
  return mutate(() => {
    ensureLoaded();
    const target = lowercaseKey(username);
    const now = Date.now();
    const matches: string[] = [];
    for (const [k, v] of inviteStore()) {
      if (v.tokenPrefix !== prefix) continue;
      if (v.consumed) continue;
      if (v.expiresAt < now) continue;
      matches.push(k);
      if (matches.length > 1) break;
    }
    if (matches.length === 0) return "not_found";
    if (matches.length > 1) return "ambiguous";
    const k = matches[0];
    const row = inviteStore().get(k)!;
    if (!row.username || lowercaseKey(row.username) !== target) {
      return "not_found";
    }
    inviteStore().delete(k);
    try {
      persistInvites();
    } catch (err) {
      inviteStore().set(k, row);
      throw err;
    }
    return "ok";
  });
}
