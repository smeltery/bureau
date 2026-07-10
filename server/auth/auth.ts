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
import { claimUserByName, getUserByName, hasOwner } from "../users.ts";
import { hashOf, randomToken, safeHashEq } from "./tokens.ts";
import { setHasOwnerProvider } from "./http-env.ts";
export { forceExpireSocketsForSession, registerSocket, unregisterSocket } from "./session-sockets.ts";
export { setRoomsSnapshotProvider } from "./bootstrap-owner.ts";
import { commitBootstrapOwnerUser, snapshotRoomIds } from "./bootstrap-owner.ts";
import { markAllUnconsumedBootstrapInvitesConsumed } from "./bootstrap-invites.ts";
import { ensureLoaded, inviteStore, mutate, persistInvites, persistSessions, sessionStore, type StoredInvite, type StoredSession } from "./store.ts";
export { listActiveSessions, listActiveSessionsForUserId, listInvites, listInvitesForUsername } from "./lists.ts";
export { revokeInviteByPrefix, revokeOutstandingInviteByPrefixForUsername, type RevokeResult } from "./invite-revocation.ts";
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
// Hooks for the dispatcher to be notified of acceptance events. Used so
// index.ts can broadcast updated invite/session lists to owner WSes when
// an invite is consumed via HTTP (which never touches the WS dispatch
// path and therefore wouldn't otherwise trigger a fan-out). Defaults to
// no-op so auth.ts stays standalone; index.ts overrides at boot.

let onInviteConsumedHook: () => void = () => {};

export function setOnInviteConsumed(cb: () => void): void {
  onInviteConsumedHook = cb;
}

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
}

export interface MintResult {
  ok: true;
  rawToken: string;
  invite: StoredInvite;
}
export interface MintErr {
  ok: false;
  error: string;
  code: "INVALID_USERNAME" | "USER_EXISTS" | "INVALID_ROLE" | "ROLE_MISMATCH";
}

export async function mintInvite(opts: MintOptions): Promise<MintResult | MintErr> {
  return mutate(() => {
    ensureLoaded();
    const trimmedName = opts.username?.trim() ?? null;
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

// Look up an invite without consuming it. Used by GET /i/<token> so link
// previewers / chat unfurlers / browser prefetch don't burn the one-time
// invite — actual consumption happens on the subsequent POST.
export interface InvitePeek {
  needsName: boolean;
  username: string | null;
  role: UserRole;
  bootstrap: boolean;
}
export function peekInvite(rawToken: string): InvitePeek | { error: "not_found" | "consumed" | "expired" | "owner_exists" } {
  ensureLoaded();
  if (!rawToken) return { error: "not_found" };
  const hash = hashOf(rawToken);
  const invite = inviteStore().get(hash);
  if (!invite) return { error: "not_found" };
  if (!safeHashEq(invite.tokenHash, hash)) return { error: "not_found" };
  if (invite.consumed) return { error: "consumed" };
  if (invite.expiresAt < Date.now()) return { error: "expired" };
  if (invite.bootstrap && hasOwner()) return { error: "owner_exists" };
  return {
    needsName: invite.username === null,
    username: invite.username,
    role: invite.role,
    bootstrap: invite.bootstrap,
  };
}

export interface AcceptOk {
  ok: true;
  rawSessionId: string;
  expiresAt: number;
  absoluteExpiresAt: number;
  username: string;
  role: UserRole;
  isBootstrap: boolean;
  inviteNeedsName: boolean;
}
export interface AcceptErr {
  ok: false;
  error: "not_found" | "consumed" | "expired" | "needs_name" | "invalid_name" | "role_mismatch" | "owner_exists";
}

// Accept an invite token. If the invite has a pre-set username, that username
// is bound to the new session. If the invite is a bootstrap invite, the
// caller must supply `chosenName` (the only path where invitees pick their
// own display name).
export async function acceptInvite(rawToken: string, ctx: { userAgent: string | null; chosenName?: string | null }): Promise<AcceptOk | AcceptErr> {
  return mutate(() => {
    ensureLoaded();
    const hash = hashOf(rawToken);
    const invite = inviteStore().get(hash);
    if (!invite) return { ok: false, error: "not_found" };
    if (!safeHashEq(invite.tokenHash, hash)) return { ok: false, error: "not_found" };
    if (invite.consumed) return { ok: false, error: "consumed" };
    if (invite.expiresAt < Date.now()) return { ok: false, error: "expired" };

    // Bootstrap invites are stale the moment an owner exists. Rechecked
    // under the mutex so concurrent acceptances serialize: if a sibling
    // bootstrap accept just minted an owner, this one fails closed.
    if (invite.bootstrap && hasOwner()) {
      markAllUnconsumedBootstrapInvitesConsumed();
      return { ok: false, error: "owner_exists" };
    }

    let chosenName: string | null = invite.username;
    if (invite.username === null) {
      const raw = (ctx.chosenName ?? "").trim();
      if (!raw) return { ok: false, error: "needs_name" };
      if (raw.length > 64) return { ok: false, error: "invalid_name" };
      if (!/^[\p{L}\p{N} ._'-]+$/u.test(raw)) return { ok: false, error: "invalid_name" };
      chosenName = raw;
    } else {
      const existing = getUserByName(invite.username);
      if (existing && existing.role !== invite.role) return { ok: false, error: "role_mismatch" };
    }
    if (!chosenName) return { ok: false, error: "invalid_name" };

    let userRecord = getUserByName(chosenName);
    let bootstrapRollback: (() => void) | null = null;
    if (invite.bootstrap) {
      const committed = commitBootstrapOwnerUser(chosenName);
      userRecord = committed.user;
      bootstrapRollback = committed.rollback;
    } else if (!userRecord) {
      // Owner invites seed the new owner with every current room id;
      // member invites land on the [] default, leaving the new member
      // with no rooms visible until an owner grants access or they
      // create their own.
      userRecord = claimUserByName(chosenName, {
        role: invite.role,
        ...(invite.role === "owner" ? { allowedRooms: snapshotRoomIds() } : {}),
      });
    }

    const { raw: rawSessionId, hash: sessionHash, prefix } = randomToken();
    const now = Date.now();
    const rollingTtlMs = 30 * 24 * 60 * 60 * 1000;
    const absoluteTtlMs = 365 * 24 * 60 * 60 * 1000;
    const session: StoredSession = {
      sessionIdHash: sessionHash,
      sessionPrefix: prefix,
      userId: userRecord.id,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + rollingTtlMs,
      absoluteExpiresAt: now + absoluteTtlMs,
      userAgent: ctx.userAgent,
    };

    // Fail-closed ordering: persist the invite-consumed flag BEFORE the
    // session. If we issued a cookie but the invite stayed live, the
    // bearer URL would still be redeemable for a second session — the
    // worse failure mode.
    const prevConsumed = invite.consumed;
    invite.consumed = true;
    invite.consumedAt = now;
    try {
      persistInvites();
    } catch (err) {
      invite.consumed = prevConsumed;
      invite.consumedAt = null;
      if (bootstrapRollback) bootstrapRollback();
      throw err;
    }
    sessionStore().set(sessionHash, session);
    try {
      persistSessions();
    } catch (err) {
      sessionStore().delete(sessionHash);
      invite.consumed = prevConsumed;
      invite.consumedAt = null;
      try {
        persistInvites();
      } catch (revertErr) {
        console.error("[auth] catastrophic: invite consumed on disk but session " + "persist + revert both failed; this invite is now permanently " + "unusable. Mint a replacement.", err, revertErr);
      }
      if (bootstrapRollback) bootstrapRollback();
      throw err;
    }

    try {
      onInviteConsumedHook();
    } catch (err) {
      console.error("[auth] onInviteConsumedHook threw:", err);
    }

    if (invite.bootstrap) {
      markAllUnconsumedBootstrapInvitesConsumed();
    }

    return {
      ok: true,
      rawSessionId,
      expiresAt: session.expiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      username: userRecord.name,
      role: userRecord.role,
      isBootstrap: invite.bootstrap,
      inviteNeedsName: invite.username === null,
    };
  });
}

export interface ClaimOk {
  ok: true;
  rawSessionId: string;
  expiresAt: number;
  absoluteExpiresAt: number;
  username: string;
}
export interface ClaimErr {
  ok: false;
  error: "owner_exists" | "needs_name" | "invalid_name";
}

// Tokenless owner-claim used by the pre-claim form at GET /. The caller is
// responsible for the locality guarantee (the server binds 127.0.0.1
// pre-claim, plus a peer-IP loopback check and a strict same-origin check
// on the POST); this function is only the auth-state mutation under the
// mutex.
export async function claimOwnership(rawChosenName: string, ctx: { userAgent: string | null }): Promise<ClaimOk | ClaimErr> {
  return mutate(() => {
    ensureLoaded();
    if (hasOwner()) {
      markAllUnconsumedBootstrapInvitesConsumed();
      return { ok: false, error: "owner_exists" };
    }
    const chosenName = rawChosenName.trim();
    if (!chosenName) return { ok: false, error: "needs_name" };
    if (chosenName.length > 64) return { ok: false, error: "invalid_name" };
    if (!/^[\p{L}\p{N} ._'-]+$/u.test(chosenName)) return { ok: false, error: "invalid_name" };

    const { user: userRecord, rollback } = commitBootstrapOwnerUser(chosenName);

    const { raw: rawSessionId, hash: sessionHash, prefix } = randomToken();
    const now = Date.now();
    const rollingTtlMs = 30 * 24 * 60 * 60 * 1000;
    const absoluteTtlMs = 365 * 24 * 60 * 60 * 1000;
    const session: StoredSession = {
      sessionIdHash: sessionHash,
      sessionPrefix: prefix,
      userId: userRecord.id,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + rollingTtlMs,
      absoluteExpiresAt: now + absoluteTtlMs,
      userAgent: ctx.userAgent,
    };
    sessionStore().set(sessionHash, session);
    try {
      persistSessions();
    } catch (err) {
      sessionStore().delete(sessionHash);
      rollback();
      throw err;
    }

    markAllUnconsumedBootstrapInvitesConsumed();

    return {
      ok: true,
      rawSessionId,
      expiresAt: session.expiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
      username: userRecord.name,
    };
  });
}
