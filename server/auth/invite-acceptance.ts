import type { UserRole } from "../../shared/types.ts";
import { claimUserByName, getUserByName, hasOwner } from "../users.ts";
import { commitBootstrapOwnerUser, snapshotRoomIds } from "./bootstrap-owner.ts";
import { markAllUnconsumedBootstrapInvitesConsumed } from "./bootstrap-invites.ts";
import { createSessionForUser } from "./session-creation.ts";
import { hashOf, safeHashEq } from "./tokens.ts";
import { ensureLoaded, inviteStore, mutate, persistInvites, persistSessions, sessionStore } from "./store.ts";

let onInviteConsumedHook: () => void = () => {};

export function setOnInviteConsumed(cb: () => void): void {
  onInviteConsumedHook = cb;
}

// Look up an invite without consuming it. Used by GET /i/<token> so link
// previewers / chat unfurlers / browser prefetch don't burn the one-time
// invite; actual consumption happens on the subsequent POST.
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
        ...(invite.role === "owner" ? { allowedRooms: snapshotRoomIds() } : invite.allowedRooms ? { allowedRooms: invite.allowedRooms } : {}),
      });
    }

    const { rawSessionId, sessionHash, session } = createSessionForUser(userRecord.id, ctx.userAgent);
    const now = Date.now();

    // Fail-closed ordering: persist the invite-consumed flag BEFORE the
    // session. If we issued a cookie but the invite stayed live, the
    // bearer URL would still be redeemable for a second session; the
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
        console.error("[auth] catastrophic: invite consumed on disk but session persist + revert both failed; this invite is now permanently unusable. Mint a replacement.", err, revertErr);
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

    const { rawSessionId, sessionHash, session } = createSessionForUser(userRecord.id, ctx.userAgent);
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
