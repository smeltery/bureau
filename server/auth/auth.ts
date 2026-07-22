// Invite + cookie-session auth. State lives in two flat files alongside the
// rest of ~/.bureau/. Both are touched under a single in-process mutex so
// invite acceptance (mark-consumed + upsert-user + create-session) cannot
// interleave with concurrent acceptances of the same token.
//
// Threat model and the security stance for each primitive are documented at
// the relevant operation; if you change any of these comments, double-check
// the docs/features/access-and-invites.md and docs/security-audit.md.

import type { UserRole } from "../../shared/types.ts";
import { lowercaseKey } from "../../shared/identity.ts";
import { getUserByName, hasOwner } from "../users.ts";
import { randomToken } from "./tokens.ts";
import { setHasOwnerProvider } from "./http-env.ts";
export { forceExpireSocketsForSession, registerSocket, unregisterSocket } from "./session-sockets.ts";
export { setRoomsSnapshotProvider } from "./bootstrap-owner.ts";
import { snapshotRoomIds } from "./bootstrap-owner.ts";
import { ensureLoaded, inviteStore, mutate, persistInvites, type StoredInvite } from "./store.ts";
export { listActiveSessions, listActiveSessionsForUserId, listInvites, listInvitesForUsername } from "./lists.ts";
export { revokeInviteByPrefix, revokeOutstandingInviteByPrefixForUsername, type RevokeResult } from "./invite-revocation.ts";
export { acceptInvite, claimOwnership, peekInvite, setOnInviteConsumed, type AcceptErr, type AcceptOk, type ClaimErr, type ClaimOk, type InvitePeek } from "./invite-acceptance.ts";
export {
  countActiveOwnerSessions,
  evictSessionsForUserId,
  logoutBySessionHash,
  resolveSessionHashByPrefix,
  revalidateByHash,
  revokeActiveSessionByPrefixForUserId,
  revokeSessionByPrefix,
  sessionContextFor,
  setOnSessionsChanged,
  validateSession,
  wouldRevokeLeaveOfficeUnreachable,
  type ScopedSessionRevokeResult,
  type SessionLookup,
} from "./session-lifecycle.ts";

setHasOwnerProvider(hasOwner);
export {
  COOKIE_NAME,
  buildPublicOrigin,
  clearCookieHeader,
  freezeBootState,
  getOfficeName,
  isProcessBoundLoopback,
  isProcessPreClaim,
  readSessionCookie,
  setCookieHeader,
  setOfficeName,
  setPublicOriginFallback,
} from "./http-env.ts";

// ---------------------------------------------------------------------------
// Invite TTLs.

// Standard invite paths (bootstrap, owner-issued via mint_invite). Invite
// URLs are bearer tokens; the shorter the acceptance window, the smaller
// the exposure in browser history, the delivery channel, and disk-restorable
// backups. 24h covers every realistic delivery-to-click scenario.
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
// Member self-invite (mint_self_invite) is deliberately tighter than the
// standard 24h. The use case is "I'm at my laptop, I want to add my phone
// right now" — both devices are physically with the member and the link is
// intended to be clicked within seconds.
const SELF_INVITE_TTL_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Mint / accept / revoke invites

export interface MintOptions {
  username: string | null; // null only allowed for bootstrap path internally
  role: UserRole;
  createdBy: string | null;
  allowExisting: boolean;
  bootstrap?: boolean;
  // Member self-invite path: revoke any other outstanding (unconsumed,
  // unexpired) invite bound to the same username in the same mutation, so
  // each member only ever has one active self-invite. Atomic with the new
  // mint so a concurrent caller can't see both the old and new at once.
  replacePriorForUsername?: boolean;
  // Override the default TTL. Used by the admin-socket recovery handler
  // (shell access + immediate hand-off to a browser, so a 15min window is
  // both tight enough to be safe and loose enough for the device switch).
  // Not exposed on the WS wire; the WS paths stick to INVITE_TTL_MS /
  // SELF_INVITE_TTL_MS so a misbehaving client can't shorten or lengthen
  // tokens it issues to third parties.
  ttlMsOverride?: number;
  allowedRooms?: string[];
}

export interface MintResult {
  ok: true;
  rawToken: string;
  invite: StoredInvite;
}
export interface MintErr {
  ok: false;
  error: string;
  code: "INVALID_USERNAME" | "USER_EXISTS" | "INVALID_ROLE" | "ROLE_MISMATCH" | "INVALID_ALLOWED_ROOMS";
}

export async function mintInvite(opts: MintOptions): Promise<MintResult | MintErr> {
  return mutate(() => {
    ensureLoaded();
    const trimmedName = opts.username?.trim() ?? null;
    let allowedRooms: string[] | undefined;
    if (!opts.bootstrap) {
      if (!trimmedName) return { ok: false, error: "Username required", code: "INVALID_USERNAME" };
      if (opts.role !== "owner" && opts.role !== "member") return { ok: false, error: "Invalid role", code: "INVALID_ROLE" };
      const existing = getUserByName(trimmedName);
      if (existing && !opts.allowExisting) {
        return {
          ok: false,
          error: `User "${existing.name}" already exists. Use allowExisting to issue an additional invite for them.`,
          code: "USER_EXISTS",
        };
      }
      if (existing && existing.role !== opts.role) {
        return {
          ok: false,
          error: `Invite role (${opts.role}) does not match existing user role (${existing.role}). Change the user's role first.`,
          code: "ROLE_MISMATCH",
        };
      }
      if (opts.allowedRooms !== undefined) {
        if (opts.role !== "member") return { ok: false, error: "Room grants are only supported for member invites", code: "INVALID_ALLOWED_ROOMS" };
        if (existing) return { ok: false, error: "Room grants are only supported for new users", code: "INVALID_ALLOWED_ROOMS" };
        if (!Array.isArray(opts.allowedRooms) || !opts.allowedRooms.every((id) => typeof id === "string")) {
          return { ok: false, error: "allowedRooms must be an array of room ids", code: "INVALID_ALLOWED_ROOMS" };
        }
        const roomIds = new Set(snapshotRoomIds());
        allowedRooms = [];
        for (const roomId of opts.allowedRooms) {
          if (!roomIds.has(roomId)) return { ok: false, error: "allowedRooms contains an unknown room id", code: "INVALID_ALLOWED_ROOMS" };
          if (!allowedRooms.includes(roomId)) allowedRooms.push(roomId);
        }
      }
    }

    const removedKeys: string[] = [];
    const removedSnapshots: StoredInvite[] = [];
    if (opts.replacePriorForUsername && trimmedName) {
      const target = lowercaseKey(trimmedName);
      const now0 = Date.now();
      for (const [k, v] of inviteStore()) {
        if (v.consumed) continue;
        if (v.expiresAt < now0) continue;
        if (!v.username || lowercaseKey(v.username) !== target) continue;
        removedKeys.push(k);
        removedSnapshots.push(v);
      }
      for (const k of removedKeys) inviteStore().delete(k);
    }

    const { raw, hash, prefix } = randomToken();
    const now = Date.now();
    const invite: StoredInvite = {
      tokenHash: hash,
      tokenPrefix: prefix,
      username: trimmedName,
      role: opts.role,
      createdBy: opts.createdBy,
      createdAt: now,
      expiresAt: now + (opts.ttlMsOverride !== undefined ? opts.ttlMsOverride : opts.replacePriorForUsername ? SELF_INVITE_TTL_MS : INVITE_TTL_MS),
      consumed: false,
      consumedAt: null,
      bootstrap: !!opts.bootstrap,
      ...(allowedRooms ? { allowedRooms } : {}),
    };
    inviteStore().set(hash, invite);
    try {
      persistInvites();
    } catch (err) {
      inviteStore().delete(hash);
      for (let i = 0; i < removedKeys.length; i++) {
        inviteStore().set(removedKeys[i], removedSnapshots[i]);
      }
      throw err;
    }
    return { ok: true, rawToken: raw, invite };
  });
}
