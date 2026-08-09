// The two in-memory tables the handshake runs on — minted sign-in codes and
// live app sessions — plus the fixed-window limiters that bound both.
//
// Consumed by server/apps/host/auth.ts, which owns the request-shaped half of
// the handshake, and through it by server/apps/host/dispatch.ts.
//
// Nothing here is persisted, deliberately: a code lives 45 seconds and an app
// session is re-established by one invisible redirect, so surviving a restart
// buys nothing and would mean writing credentials to disk. A bureau restart
// costs every app-host visitor one redirect.
//
// THE OFFICE SESSION IS THE SOURCE OF TRUTH. Every row here points at the office
// session that vouched for it by hash, and that session is revalidated on EVERY
// request — so a sign-out, a revoke, an expiry, a deleted user or a demotion
// closes the app immediately rather than at the app cookie's leisure. Nothing in
// this file can extend an office session's life, and nothing hands an office
// identity back to app code: the app-facing answer is a boolean.

import type { AppRecord } from "../../../shared/apps.ts";
import type { UserRole } from "../../../shared/types.ts";
import { revalidateByHash } from "../../auth/auth.ts";
import {
  APP_CODE_TTL_MS,
  APP_MINT_MAX_PER_WINDOW,
  APP_MINT_WINDOW_MS,
  APP_REDEEM_MAX_PER_WINDOW,
  APP_REDEEM_WINDOW_MS,
  APP_SESSION_TTL_MS,
  MAX_APP_SESSIONS,
  MAX_PENDING_CODES,
  MAX_TRACKED_LIMITER_KEYS,
  hashOf,
  isTokenShaped,
  randomTokenValue,
  safeHashEq,
} from "./auth-cookie.ts";
import { mayReachApp } from "./auth-permit.ts";

// --- the office session, as this arm sees it --------------------------------

// What a live office session contributes: an identity for the permit decision
// and the absolute cap that bounds anything derived from it. A subset of
// SessionLookup on purpose — an app session needs no session prefix, no rolling
// state, and no way to write any of it back.
export interface OfficeSessionFacts {
  userId: string;
  role: UserRole;
  absoluteExpiresAt: number;
}

let resolveOfficeSession: (sessionIdHash: string) => OfficeSessionFacts | null = revalidateByHash;

// The one place this arm asks "is that office session still alive, and whose is
// it". Named so both the redeem path and the per-request gate go through the
// same question.
export function officeSessionByHash(sessionIdHash: string): OfficeSessionFacts | null {
  return resolveOfficeSession(sessionIdHash);
}

// --- fixed-window rate limiting ---------------------------------------------

// The same shape twice, with the failure posture as a constructor argument
// because the two sides fail in opposite directions:
//
//   mint   - fail CLOSED when the table is full. Refusing to mint is a 429 the
//            user can retry; minting untracked would remove the only bound on a
//            redirect loop.
//   redeem - fail OPEN. It guards a 256-bit code, so it is nuisance control, and
//            a full table failing closed would lock every app's users out of
//            signing in at all.
class FixedWindowLimiter {
  private windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly windowMs: number,
    private readonly maxPerWindow: number,
    private readonly failOpenWhenFull: boolean,
  ) {}

  allow(key: string, now: number): boolean {
    const w = this.windows.get(key);
    if (w && now - w.start < this.windowMs) {
      w.count++;
      return w.count <= this.maxPerWindow;
    }
    if (!w && this.windows.size >= MAX_TRACKED_LIMITER_KEYS) {
      for (const [k, win] of this.windows) {
        if (now - win.start >= this.windowMs) this.windows.delete(k);
      }
      if (this.windows.size >= MAX_TRACKED_LIMITER_KEYS) {
        return this.failOpenWhenFull;
      }
    }
    this.windows.set(key, { start: now, count: 1 });
    return true;
  }

  reset(): void {
    this.windows.clear();
  }
}

const mintLimiter = new FixedWindowLimiter(APP_MINT_WINDOW_MS, APP_MINT_MAX_PER_WINDOW, false);
const redeemLimiter = new FixedWindowLimiter(APP_REDEEM_WINDOW_MS, APP_REDEEM_MAX_PER_WINDOW, true);

// --- the two tables ---------------------------------------------------------

// A minted, not-yet-redeemed code. `codeHash` is stored alongside being the map
// key so the constant-time re-check after a lookup has something to compare
// against; the raw code is never stored anywhere.
export interface PendingCode {
  codeHash: string;
  // The app this code opens, as the issuance tuple the registry treats as an
  // app's identity — not the label alone. A label is unique forever, so the
  // generation is belt: it makes a cookie from `hello` gen 1 structurally
  // incapable of vouching for a later `hello`.
  label: string;
  hostGen: number;
  // The exact normalized hostname the code may be redeemed at.
  appHost: string;
  // The office session that minted it. The app session inherits this, and it is
  // revalidated on every subsequent request.
  officeSessionHash: string;
  // Where to send the browser after redemption. Kept HERE rather than in the
  // callback URL (code only, no path) so it is validated exactly once, cannot be
  // swapped between the two hops, and is not a second value written into a
  // browser's history.
  returnPath: string;
  expiresAt: number;
}

interface AppSession {
  tokenHash: string;
  label: string;
  hostGen: number;
  officeSessionHash: string;
  expiresAt: number;
}

const pendingCodes = new Map<string, PendingCode>();
const appSessions = new Map<string, AppSession>();

function pruneExpired<T extends { expiresAt: number }>(table: Map<string, T>, now: number): void {
  for (const [key, row] of table) {
    if (row.expiresAt <= now) table.delete(key);
  }
}

// --- the code store ---------------------------------------------------------

export type MintFailure = "rate_limited" | "no_capacity";

export function mintAppCode(
  input: { label: string; hostGen: number; appHost: string; officeSessionHash: string; returnPath: string },
  now: number = Date.now(),
): { code: string } | { error: MintFailure } {
  if (!mintLimiter.allow(input.officeSessionHash, now)) {
    return { error: "rate_limited" };
  }
  pruneExpired(pendingCodes, now);
  if (pendingCodes.size >= MAX_PENDING_CODES) {
    // Fail closed rather than evicting somebody else's live code: a full table
    // is a 429 the user retries, and evicting would turn one user's flood into
    // another user's broken sign-in.
    return { error: "no_capacity" };
  }
  const code = randomTokenValue();
  const codeHash = hashOf(code);
  pendingCodes.set(codeHash, { codeHash, ...input, expiresAt: now + APP_CODE_TTL_MS });
  return { code };
}

// Redeem, in the one order that makes single-use unconditional:
//
//   syntactic bound -> hash -> get -> DELETE -> charge the limiter -> validate
//
// Deleting before anything else can fail is what makes a code single-use even
// under a race or a refusal: every presentation of a well-formed code consumes
// it, including one that arrives while the app's redeem budget is spent. The
// alternative — check the limiter first — would leave a valid code alive and
// replayable because somebody else was noisy.
export function redeemAppCode(rawCode: string | null, ctx: { host: string; label: string; now?: number }): PendingCode | null {
  const now = ctx.now ?? Date.now();
  if (!isTokenShaped(rawCode)) return null;
  const codeHash = hashOf(rawCode);
  const record = pendingCodes.get(codeHash);
  pendingCodes.delete(codeHash);
  if (!redeemLimiter.allow(ctx.label, now)) return null;
  if (!record) return null;
  if (!safeHashEq(record.codeHash, codeHash)) return null;
  if (record.expiresAt <= now) return null;
  if (record.appHost !== ctx.host) return null;
  if (record.label !== ctx.label) return null;
  return record;
}

// --- the app-session store --------------------------------------------------

// Start a session for a redeemed code. The deadline is the office session's
// absolute cap or this session's own TTL, whichever comes first: an app session
// must never outlive the office session that vouched for it, and nothing here
// may extend that session's life.
//
// Returns null when there is no positive lifetime left — a session inside its
// last second. Emitting `Max-Age=0` would be a cookie the browser deletes on
// arrival, i.e. reporting success and handing back nothing.
export function startAppSession(
  input: { label: string; hostGen: number; officeSessionHash: string; absoluteExpiresAt: number },
  now: number = Date.now(),
): { token: string; maxAgeSec: number } | null {
  const deadline = Math.min(now + APP_SESSION_TTL_MS, input.absoluteExpiresAt);
  const maxAgeSec = Math.floor((deadline - now) / 1000);
  if (maxAgeSec <= 0) return null;
  pruneExpired(appSessions, now);
  if (appSessions.size >= MAX_APP_SESSIONS) {
    // Evict the row closest to expiry. Unlike a code, an app session can be
    // re-established invisibly (one redirect), so failing closed here would cost
    // availability for nothing.
    let oldestKey: string | null = null;
    let oldestExpiry = Infinity;
    for (const [key, row] of appSessions) {
      if (row.expiresAt < oldestExpiry) {
        oldestExpiry = row.expiresAt;
        oldestKey = key;
      }
    }
    if (oldestKey !== null) appSessions.delete(oldestKey);
  }
  const token = randomTokenValue();
  const tokenHash = hashOf(token);
  appSessions.set(tokenHash, { tokenHash, label: input.label, hostGen: input.hostGen, officeSessionHash: input.officeSessionHash, expiresAt: deadline });
  return { token, maxAgeSec };
}

// The app this cookie may reach, or null. Fail-closed at every step, and the last
// two steps are the ones that matter: the office session is revalidated by hash
// on EVERY request, and the permit decision is re-asked against the app that is
// live NOW — so a sign-out, a revoke, an expiry, a deleted user or a demotion
// closes the app immediately.
export function validateAppSession(rawCookie: string | null, ctx: { app: Pick<AppRecord, "hostLabel" | "hostGen" | "userId">; now?: number }): boolean {
  // Present-but-empty lands here as `""` and is refused like any other value that
  // is not a live token.
  if (!isTokenShaped(rawCookie)) return false;
  const now = ctx.now ?? Date.now();
  const tokenHash = hashOf(rawCookie);
  const row = appSessions.get(tokenHash);
  if (!row) return false;
  if (!safeHashEq(row.tokenHash, tokenHash)) return false;
  if (row.expiresAt <= now) {
    appSessions.delete(tokenHash);
    return false;
  }
  if (row.label !== ctx.app.hostLabel || row.hostGen !== ctx.app.hostGen) return false;
  const office = officeSessionByHash(row.officeSessionHash);
  if (office === null) {
    // The office session is gone. The app session is orphaned and will never be
    // valid again, so drop the row rather than re-checking it forever.
    appSessions.delete(tokenHash);
    return false;
  }
  // A demotion is NOT orphaning: the office session is still live and may regain
  // access to other apps, so the row stays and the answer is simply no.
  return mayReachApp(ctx.app, { userId: office.userId, role: office.role });
}

// --- test-only seams --------------------------------------------------------

// How many minted codes are still outstanding. Test-only, and it exists for one
// assertion that cannot be made from the outside: that presenting a code
// CONSUMES it even when the presentation is refused. Both orders of the delete
// and the rate-limit check return the same refusal, so the difference is only
// visible in the table.
export function _testPendingCodeCount(): number {
  return pendingCodes.size;
}

// Stand in for the office session store, so the positive paths can be exercised
// without booting a server. Test-only and NOT a parameter on any production
// function on purpose: a caller must not be able to hand this arm a weaker
// notion of "the office says yes". `null` restores the real store.
export function _testSetOfficeSessionResolver(fn: ((sessionIdHash: string) => OfficeSessionFacts | null) | null): void {
  resolveOfficeSession = fn ?? revalidateByHash;
}

export function _testResetAppAuth(): void {
  pendingCodes.clear();
  appSessions.clear();
  mintLimiter.reset();
  redeemLimiter.reset();
}
