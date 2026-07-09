// Invite + cookie-session auth. State lives in two flat files alongside the
// rest of ~/.bureau/. Both are touched under a single in-process mutex so
// invite acceptance (mark-consumed + upsert-user + create-session) cannot
// interleave with concurrent acceptances of the same token.
//
// Threat model and the security stance for each primitive are documented at
// the relevant operation; if you change any of these comments, double-check
// the docs/features/access-and-invites.md and docs/security-audit.md.

import { existsSync, readFileSync } from "fs";
import type { UserRole, UserRecord, InviteWire, SessionWire, SessionContext } from "../../shared/types.ts";
import { atomicWriteFileSync, INVITES_FILE, SESSIONS_FILE } from "../persistence/paths.ts";
import { lowercaseKey } from "../../shared/identity.ts";
import { claimUserByName, deleteUserById, getUserById, getUserByName, hasOwner, setUserRoleById, updateUserById } from "../users.ts";
import { hashOf, randomToken, safeHashEq } from "./tokens.ts";
import { setHasOwnerProvider } from "./http-env.ts";
export { forceExpireSocketsForSession, registerSocket, unregisterSocket } from "./session-sockets.ts";
import { forceExpireSocketsForSession } from "./session-sockets.ts";

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

// Injected by server/index.ts at boot. New owners need a snapshot of every
// current room id as their initial allowedRooms (the strict string[] model
// has no "all" sentinel, so "owners see every room" has to be materialized
// at creation time). auth.ts is intentionally kept free of agent-manager
// dependencies; the provider sidesteps a cycle.
let roomsSnapshotProvider: (() => string[]) | null = null;
export function setRoomsSnapshotProvider(fn: () => string[]): void {
  roomsSnapshotProvider = fn;
}
function snapshotRoomIds(): string[] {
  return roomsSnapshotProvider ? roomsSnapshotProvider() : [];
}

// ---------------------------------------------------------------------------
// On-disk record shapes (hashed). Raw tokens never persist.

interface StoredInvite {
  tokenHash: string; // sha256(rawToken) hex; the map key duplicates this for convenience
  tokenPrefix: string; // first 8 chars of the raw base64url token, kept clear for UI
  username: string | null; // null only for bootstrap invites
  role: UserRole;
  createdBy: string | null; // null for bootstrap
  createdAt: number;
  expiresAt: number;
  consumed: boolean;
  consumedAt: number | null;
  bootstrap: boolean;
}

interface StoredSession {
  sessionIdHash: string; // sha256(rawSessionId) hex
  sessionPrefix: string; // first 8 chars of the raw base64url id, kept clear for UI
  // Stable user identity. `userId` is authoritative for who owns the
  // session; the display name is resolved from the user record at
  // validation time, so a rename flows through to all in-flight sessions
  // automatically.
  userId: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  absoluteExpiresAt: number;
  userAgent: string | null;
}

// ---------------------------------------------------------------------------
// In-process state. Loaded once on first call; mutated under `mutate()`.

let invites: Map<string, StoredInvite> | null = null;
let sessions: Map<string, StoredSession> | null = null;

// Mutex: a chain of promises. Each `mutate` awaits the previous link before
// running, so concurrent invite acceptances and revocations serialize. The
// chain lives at module scope so it survives across the call sites we care
// about (HTTP handlers, WS handlers, bootstrap).
let mutexTail: Promise<unknown> = Promise.resolve();
function mutate<T>(fn: () => Promise<T> | T): Promise<T> {
  const run = mutexTail.then(() => fn());
  // Swallow errors on the tail so a thrown caller doesn't poison the chain.
  mutexTail = run.catch(() => undefined);
  return run;
}

// ---------------------------------------------------------------------------
// Load / persist

function loadInvitesFromDisk(): Map<string, StoredInvite> {
  const map = new Map<string, StoredInvite>();
  try {
    if (!existsSync(INVITES_FILE)) return map;
    const raw = readFileSync(INVITES_FILE, "utf-8");
    if (!raw.trim()) return map;
    const parsed = JSON.parse(raw) as Record<string, StoredInvite>;
    for (const [k, v] of Object.entries(parsed)) {
      if (!v || typeof v.tokenHash !== "string") continue;
      map.set(k, v);
    }
  } catch (err) {
    console.error("Failed to load invites.json:", err);
  }
  return map;
}

function loadSessionsFromDisk(): Map<string, StoredSession> {
  const map = new Map<string, StoredSession>();
  try {
    if (!existsSync(SESSIONS_FILE)) return map;
    const raw = readFileSync(SESSIONS_FILE, "utf-8");
    if (!raw.trim()) return map;
    const parsed = JSON.parse(raw) as Record<string, Partial<StoredSession>>;
    for (const [k, v] of Object.entries(parsed)) {
      if (!v || typeof v.sessionIdHash !== "string") continue;
      if (typeof v.userId !== "string" || !v.userId) continue;
      map.set(k, {
        sessionIdHash: v.sessionIdHash,
        sessionPrefix: v.sessionPrefix ?? "",
        userId: v.userId,
        createdAt: v.createdAt ?? Date.now(),
        lastSeenAt: v.lastSeenAt ?? Date.now(),
        expiresAt: v.expiresAt ?? 0,
        absoluteExpiresAt: v.absoluteExpiresAt ?? 0,
        userAgent: v.userAgent ?? null,
      });
    }
  } catch (err) {
    console.error("Failed to load sessions.json:", err);
  }
  return map;
}

// Auth state mutations must surface persistence failures to the caller so
// the caller can roll back in-memory state. Swallowing here would let
// accept/mint/revoke report success while disk diverges from memory — on
// the next restart the user would be locked out (consumed invite + lost
// session) or able to reuse a "revoked" invite.
function persistInvites() {
  if (!invites) return;
  const obj: Record<string, StoredInvite> = {};
  for (const [k, v] of invites) obj[k] = v;
  atomicWriteFileSync(INVITES_FILE, JSON.stringify(obj, null, 2));
}

function persistSessions() {
  if (!sessions) return;
  const obj: Record<string, StoredSession> = {};
  for (const [k, v] of sessions) obj[k] = v;
  atomicWriteFileSync(SESSIONS_FILE, JSON.stringify(obj, null, 2));
}

function ensureLoaded() {
  if (invites === null) invites = loadInvitesFromDisk();
  if (sessions === null) sessions = loadSessionsFromDisk();
}

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

// Fired whenever the active-sessions set changes via server-initiated
// invalidation: revoke, logout, evict-after-delete, hot-path expiry,
// hot-path orphan cleanup. The dispatcher wires this to broadcast a
// fresh sessions_active_list to owners so their Access pane sessions
// table stays current without each call site having to remember.
let onSessionsChangedHook: () => void = () => {};

export function setOnSessionsChanged(cb: () => void): void {
  onSessionsChangedHook = cb;
}

function fireSessionsChangedHook(): void {
  try {
    onSessionsChangedHook();
  } catch (err) {
    console.error("[auth] onSessionsChangedHook threw:", err);
  }
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
      for (const [k, v] of invites!) {
        if (v.consumed) continue;
        if (v.expiresAt < now0) continue;
        if (!v.username || lowercaseKey(v.username) !== target) continue;
        removedKeys.push(k);
        removedSnapshots.push(v);
      }
      for (const k of removedKeys) invites!.delete(k);
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
    invites!.set(hash, invite);
    try {
      persistInvites();
    } catch (err) {
      invites!.delete(hash);
      for (let i = 0; i < removedKeys.length; i++) {
        invites!.set(removedKeys[i], removedSnapshots[i]);
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
  const invite = invites!.get(hash);
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

// Mark every still-unconsumed bootstrap invite as consumed. Called after a
// successful bootstrap accept (siblings are now stale) and when an accept is
// refused because an owner exists (the invite itself is stale).
function markAllUnconsumedBootstrapInvitesConsumed(): void {
  const stale: StoredInvite[] = [];
  for (const inv of invites!.values()) {
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

// Owner-creation core used by both the tokenless claim form (claimOwnership)
// and the legacy bootstrap-invite acceptance path (acceptInvite bootstrap
// branch). Mutates user state so the named user becomes an owner with full
// allowedRooms, then returns the resulting user record alongside a
// `rollback` closure that restores the prior state.
//
// The caller MUST invoke rollback if any subsequent persistence step
// (invite-consumed write, session create+persist) throws.
function commitBootstrapOwnerUser(chosenName: string): {
  user: UserRecord;
  rollback: () => void;
} {
  const existing = getUserByName(chosenName);
  if (!existing) {
    const created = claimUserByName(chosenName, {
      role: "owner",
      allowedRooms: snapshotRoomIds(),
    });
    const createdId = created.id;
    return {
      user: created,
      rollback: () => {
        try {
          deleteUserById(createdId);
        } catch (err) {
          console.error(
            `[auth] catastrophic: bootstrap rollback could not delete just-created user ${createdId}; the office is now stranded with an owner record but no session. Once the underlying disk issue is fixed, try the owner-login recovery CLI ('bun run server/index.ts owner-login --name <chosen-name>') against the running server; if the partial record is malformed, remove ${createdId} from users.json by hand and re-open the claim form.`,
            err,
          );
        }
      },
    };
  }
  // Existing user — snapshot the prior state and build a single rollback
  // closure BEFORE any mutation. Every post-allowedRooms failure path
  // (setUserRoleById throws, the getUserById sanity check finds the row
  // gone, or the caller hits a downstream persist failure and invokes
  // rollback explicitly) reuses the same closure.
  const prevRole = existing.role;
  const prevAllowedRooms = [...existing.allowedRooms];
  const userId = existing.id;
  const restorePriorState = () => {
    try {
      setUserRoleById(userId, prevRole);
    } catch (err) {
      console.error(`[auth] bootstrap rollback: setUserRoleById restore to ${prevRole} threw for ${userId}`, err);
    }
    try {
      const rr = updateUserById(userId, { allowedRooms: prevAllowedRooms });
      if (!rr.ok) {
        console.error(`[auth] bootstrap rollback: allowedRooms restore returned not-ok for ${userId}: ${rr.error}`);
      }
    } catch (err) {
      console.error(`[auth] bootstrap rollback: allowedRooms restore threw for ${userId}`, err);
    }
  };

  const snapshot = snapshotRoomIds();
  const r = updateUserById(userId, { allowedRooms: snapshot });
  if (!r.ok) {
    throw new Error(`bootstrap owner promotion: allowedRooms write failed for ${existing.name}: ${r.error}`);
  }
  if (existing.role !== "owner") {
    try {
      setUserRoleById(userId, "owner");
    } catch (err) {
      restorePriorState();
      throw err;
    }
  }
  const updated = getUserById(userId);
  if (!updated) {
    restorePriorState();
    throw new Error(`bootstrap owner promotion: user ${userId} vanished mid-flow; rolled allowedRooms/role back to prior state`);
  }
  return { user: updated, rollback: restorePriorState };
}

// Accept an invite token. If the invite has a pre-set username, that username
// is bound to the new session. If the invite is a bootstrap invite, the
// caller must supply `chosenName` (the only path where invitees pick their
// own display name).
export async function acceptInvite(rawToken: string, ctx: { userAgent: string | null; chosenName?: string | null }): Promise<AcceptOk | AcceptErr> {
  return mutate(() => {
    ensureLoaded();
    const hash = hashOf(rawToken);
    const invite = invites!.get(hash);
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
    sessions!.set(sessionHash, session);
    try {
      persistSessions();
    } catch (err) {
      sessions!.delete(sessionHash);
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
    sessions!.set(sessionHash, session);
    try {
      persistSessions();
    } catch (err) {
      sessions!.delete(sessionHash);
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

export type RevokeResult = "ok" | "not_found" | "ambiguous";

// Find at most two matching rows; if more than one matches the same display
// prefix we refuse to revoke either, so an extremely unlikely 8-char prefix
// collision can't silently target the wrong record.
export async function revokeInviteByPrefix(prefix: string): Promise<RevokeResult> {
  return mutate(() => {
    ensureLoaded();
    const matches: string[] = [];
    for (const [k, v] of invites!) {
      if (v.tokenPrefix === prefix) matches.push(k);
      if (matches.length > 1) break;
    }
    if (matches.length === 0) return "not_found";
    if (matches.length > 1) return "ambiguous";
    const k = matches[0];
    const prev = invites!.get(k)!;
    invites!.delete(k);
    try {
      persistInvites();
    } catch (err) {
      invites!.set(k, prev);
      throw err;
    }
    return "ok";
  });
}

export async function revokeSessionByPrefix(prefix: string): Promise<RevokeResult> {
  return mutate(() => {
    ensureLoaded();
    const matches: string[] = [];
    for (const [k, v] of sessions!) {
      if (v.sessionPrefix === prefix) matches.push(k);
      if (matches.length > 1) break;
    }
    if (matches.length === 0) return "not_found";
    if (matches.length > 1) return "ambiguous";
    const hash = matches[0];
    const prev = sessions!.get(hash)!;
    sessions!.delete(hash);
    try {
      persistSessions();
    } catch (err) {
      sessions!.set(hash, prev);
      throw err;
    }
    forceExpireSocketsForSession(hash);
    fireSessionsChangedHook();
    return "ok";
  });
}

export async function logoutBySessionHash(sessionIdHash: string): Promise<boolean> {
  return mutate(() => {
    ensureLoaded();
    const prev = sessions!.get(sessionIdHash);
    if (!prev) return false;
    sessions!.delete(sessionIdHash);
    try {
      persistSessions();
    } catch (err) {
      sessions!.set(sessionIdHash, prev);
      throw err;
    }
    forceExpireSocketsForSession(sessionIdHash);
    fireSessionsChangedHook();
    return true;
  });
}

// Evict all active sessions belonging to a user. Called by delete_user so
// the deleted user's open tabs land on the login wall.
export async function evictSessionsForUserId(userId: string): Promise<number> {
  return mutate(() => {
    ensureLoaded();
    const hashes: string[] = [];
    for (const [hash, s] of sessions!) {
      if (s.userId === userId) hashes.push(hash);
    }
    if (hashes.length === 0) return 0;
    for (const hash of hashes) sessions!.delete(hash);
    try {
      persistSessions();
    } catch (err) {
      console.error(`[auth] evictSessionsForUserId persist failed (userId=${userId}, count=${hashes.length}):`, err);
    }
    for (const hash of hashes) forceExpireSocketsForSession(hash);
    fireSessionsChangedHook();
    return hashes.length;
  });
}

// ---------------------------------------------------------------------------
// Validation (per-request hot path: must be O(1), no IO).

export interface SessionLookup {
  sessionIdHash: string;
  sessionPrefix: string;
  userId: string;
  username: string;
  role: UserRole;
  needsRolling: boolean;
}

let lastPersist = 0;
const PERSIST_THROTTLE_MS = 30_000;

export function validateSession(rawCookie: string | null): SessionLookup | null {
  if (!rawCookie) return null;
  ensureLoaded();
  const hash = hashOf(rawCookie);
  return validateByHash(hash);
}

export function revalidateByHash(sessionIdHash: string): SessionLookup | null {
  ensureLoaded();
  return validateByHash(sessionIdHash);
}

function validateByHash(hash: string): SessionLookup | null {
  const session = sessions!.get(hash);
  if (!session) return null;
  if (!safeHashEq(session.sessionIdHash, hash)) return null;
  const now = Date.now();
  if (session.expiresAt < now || session.absoluteExpiresAt < now) {
    sessions!.delete(hash);
    forceExpireSocketsForSession(hash);
    fireSessionsChangedHook();
    return null;
  }
  const user = getUserById(session.userId);
  if (!user) {
    sessions!.delete(hash);
    forceExpireSocketsForSession(hash);
    fireSessionsChangedHook();
    return null;
  }
  const rollingTtlMs = 30 * 24 * 60 * 60 * 1000;
  const newExpires = Math.min(now + rollingTtlMs, session.absoluteExpiresAt);
  let needsRolling = false;
  if (newExpires > session.expiresAt + 60_000) {
    session.expiresAt = newExpires;
    needsRolling = true;
  }
  session.lastSeenAt = now;
  if (now - lastPersist > PERSIST_THROTTLE_MS) {
    lastPersist = now;
    try {
      persistSessions();
    } catch (err) {
      console.error("[auth] throttled sessions persist failed:", err);
    }
  }
  return {
    sessionIdHash: hash,
    sessionPrefix: session.sessionPrefix,
    userId: user.id,
    username: user.name,
    role: user.role,
    needsRolling,
  };
}

// ---------------------------------------------------------------------------
// Wire shapes for owner UI.

function toInviteWire(v: StoredInvite): InviteWire {
  return {
    tokenPrefix: v.tokenPrefix,
    username: v.username,
    role: v.role,
    createdBy: v.createdBy,
    createdAt: v.createdAt,
    expiresAt: v.expiresAt,
    ...(v.bootstrap ? { bootstrap: true as const } : {}),
  };
}

function toSessionWire(v: StoredSession): SessionWire {
  const user = getUserById(v.userId);
  return {
    sessionPrefix: v.sessionPrefix,
    username: user?.name ?? "(deleted)",
    createdAt: v.createdAt,
    lastSeenAt: v.lastSeenAt,
    expiresAt: v.expiresAt,
    absoluteExpiresAt: v.absoluteExpiresAt,
    userAgent: v.userAgent,
  };
}

export function listInvites(): InviteWire[] {
  ensureLoaded();
  const now = Date.now();
  const result: InviteWire[] = [];
  for (const v of invites!.values()) {
    if (v.consumed) continue;
    if (v.expiresAt < now) continue;
    result.push(toInviteWire(v));
  }
  return result.sort((a, b) => b.createdAt - a.createdAt);
}

export function listInvitesForUsername(name: string): InviteWire[] {
  ensureLoaded();
  const now = Date.now();
  const target = lowercaseKey(name);
  const result: InviteWire[] = [];
  for (const v of invites!.values()) {
    if (v.consumed) continue;
    if (v.expiresAt < now) continue;
    if (!v.username || lowercaseKey(v.username) !== target) continue;
    result.push(toInviteWire(v));
  }
  return result.sort((a, b) => b.createdAt - a.createdAt);
}

export function listActiveSessions(): SessionWire[] {
  ensureLoaded();
  const now = Date.now();
  const result: SessionWire[] = [];
  for (const v of sessions!.values()) {
    if (v.expiresAt < now || v.absoluteExpiresAt < now) continue;
    result.push(toSessionWire(v));
  }
  return result.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

export function listActiveSessionsForUserId(userId: string): SessionWire[] {
  ensureLoaded();
  const now = Date.now();
  const result: SessionWire[] = [];
  for (const v of sessions!.values()) {
    if (v.expiresAt < now || v.absoluteExpiresAt < now) continue;
    if (v.userId !== userId) continue;
    result.push(toSessionWire(v));
  }
  return result.sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

export async function revokeOutstandingInviteByPrefixForUsername(prefix: string, username: string): Promise<RevokeResult> {
  return mutate(() => {
    ensureLoaded();
    const target = lowercaseKey(username);
    const now = Date.now();
    const matches: string[] = [];
    for (const [k, v] of invites!) {
      if (v.tokenPrefix !== prefix) continue;
      if (v.consumed) continue;
      if (v.expiresAt < now) continue;
      matches.push(k);
      if (matches.length > 1) break;
    }
    if (matches.length === 0) return "not_found";
    if (matches.length > 1) return "ambiguous";
    const k = matches[0];
    const row = invites!.get(k)!;
    if (!row.username || lowercaseKey(row.username) !== target) {
      return "not_found";
    }
    invites!.delete(k);
    try {
      persistInvites();
    } catch (err) {
      invites!.set(k, row);
      throw err;
    }
    return "ok";
  });
}

export type ScopedSessionRevokeResult = RevokeResult | "would_strand_office";

export async function revokeActiveSessionByPrefixForUserId(prefix: string, userId: string): Promise<ScopedSessionRevokeResult> {
  return mutate(() => {
    ensureLoaded();
    const now = Date.now();
    const matches: string[] = [];
    for (const [k, v] of sessions!) {
      if (v.sessionPrefix !== prefix) continue;
      if (v.expiresAt < now || v.absoluteExpiresAt < now) continue;
      matches.push(k);
      if (matches.length > 1) break;
    }
    if (matches.length === 0) return "not_found";
    if (matches.length > 1) return "ambiguous";
    const hash = matches[0];
    const row = sessions!.get(hash)!;
    if (row.userId !== userId) return "not_found";
    // Confidentiality-critical: this check is *after* the scope test so a
    // foreign last-owner prefix can never produce a divergent response.
    if (wouldRevokeLeaveOfficeUnreachable(hash)) {
      return "would_strand_office";
    }
    sessions!.delete(hash);
    try {
      persistSessions();
    } catch (err) {
      sessions!.set(hash, row);
      throw err;
    }
    forceExpireSocketsForSession(hash);
    fireSessionsChangedHook();
    return "ok";
  });
}

export function sessionContextFor(lookup: SessionLookup, connectionId: string): SessionContext {
  return {
    userId: lookup.userId,
    username: lookup.username,
    role: lookup.role,
    currentSessionPrefix: lookup.sessionPrefix,
    connectionId,
  };
}

// ---------------------------------------------------------------------------
// Lockout-prevention helpers
//
// The invariant: the office must always retain at least one owner-role
// user with at least one active session, so an operator can recover from
// inside the browser.

export function countActiveOwnerSessions(): number {
  ensureLoaded();
  const now = Date.now();
  let n = 0;
  for (const s of sessions!.values()) {
    if (s.expiresAt < now || s.absoluteExpiresAt < now) continue;
    const u = getUserById(s.userId);
    if (u?.role === "owner") n++;
  }
  return n;
}

export function wouldRevokeLeaveOfficeUnreachable(sessionIdHash: string): boolean {
  ensureLoaded();
  const target = sessions!.get(sessionIdHash);
  if (!target) return false;
  const targetUser = getUserById(target.userId);
  if (targetUser?.role !== "owner") return false;
  const now = Date.now();
  for (const [hash, s] of sessions!) {
    if (hash === sessionIdHash) continue;
    if (s.expiresAt < now || s.absoluteExpiresAt < now) continue;
    const u = getUserById(s.userId);
    if (u?.role === "owner") return false;
  }
  return true;
}

export function resolveSessionHashByPrefix(prefix: string): string | null {
  ensureLoaded();
  let found: string | null = null;
  for (const [hash, s] of sessions!) {
    if (s.sessionPrefix === prefix) {
      if (found !== null) return null; // ambiguous
      found = hash;
    }
  }
  return found;
}
