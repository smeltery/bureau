// The app-host handshake's two tables and the app-scoped cookie.
//
// What this freezes:
//   - SINGLE USE IS UNCONDITIONAL. A well-formed code is consumed by the act of
//     presenting it — before the expiry check, before the host check, and before
//     the rate limiter is charged. The replay test would still pass if the delete
//     happened later, so the rate-limited case is tested too: that one only
//     passes if the delete really is first.
//   - The two tables' ceilings, and the OPPOSITE failure postures of the two
//     limiters (mint refuses when full, redeem allows) — each is a deliberate
//     choice and each would be silently reversible without a test.
//   - An app session never outlives the office session it was minted from, and a
//     zero-second lifetime is a FAILURE rather than a cookie the browser deletes
//     on arrival.
//   - THE OFFICE SESSION IS THE SOURCE OF TRUTH: a live app cookie stops working
//     the moment that session is gone, or the moment it no longer permits the app.
//   - The app cookie is its own name with the attributes `__Host-` demands, and
//     the reader cannot see an office cookie at all.
//
// No server, no clock, no I/O: the office session store is stood in for through
// the test-only seam.

import { beforeEach, describe, expect, it } from "bun:test";
import { APP_CODE_TTL_MS, APP_COOKIE_NAME, APP_MINT_MAX_PER_WINDOW, APP_REDEEM_MAX_PER_WINDOW, APP_SESSION_TTL_MS, appCookieClearLine, readAppCookie } from "./host-auth-cookie.ts";
import {
  _testPendingCodeCount,
  _testResetAppAuth,
  _testSetOfficeSessionResolver,
  mintAppCode,
  redeemAppCode,
  startAppSession,
  validateAppSession,
  type OfficeSessionFacts,
} from "./host-auth-store.ts";

const HOST = "hello.office.example";
const LABEL = "hello";
const SESSION_HASH = "a".repeat(64);
const ABSOLUTE = 5_000_000_000_000;
const APP = { hostLabel: LABEL, hostGen: 1, userId: "u-alice" };

function mint(overrides: Partial<Parameters<typeof mintAppCode>[0]> = {}, now = 1_000_000): string {
  const res = mintAppCode({ label: LABEL, hostGen: 1, appHost: HOST, officeSessionHash: SESSION_HASH, returnPath: "/", ...overrides }, now);
  if ("error" in res) throw new Error(`mint failed: ${res.error}`);
  return res.code;
}

// The office session this arm is told about. Default: alive, alice's, capped far
// in the future.
function officeSaysYes(over: Partial<OfficeSessionFacts> = {}): void {
  _testSetOfficeSessionResolver(() => ({ userId: "u-alice", role: "member", absoluteExpiresAt: ABSOLUTE, ...over }));
}

beforeEach(() => {
  _testResetAppAuth();
  _testSetOfficeSessionResolver(null);
});

describe("app sign-in codes", () => {
  it("redeems once, and the second attempt fails", () => {
    const code = mint();
    const first = redeemAppCode(code, { host: HOST, label: LABEL, now: 1_000_100 });
    expect(first?.returnPath).toBe("/");
    expect(redeemAppCode(code, { host: HOST, label: LABEL, now: 1_000_100 })).toBeNull();
  });

  it("carries the return path server-side instead of in the callback URL", () => {
    const code = mint({ returnPath: "/deep/path?x=1" });
    const record = redeemAppCode(code, { host: HOST, label: LABEL, now: 1_000_100 });
    expect(record?.returnPath).toBe("/deep/path?x=1");
    expect(record?.hostGen).toBe(1);
    expect(record?.officeSessionHash).toBe(SESSION_HASH);
  });

  it("expires", () => {
    const code = mint();
    const atExpiry = 1_000_000 + APP_CODE_TTL_MS;
    expect(redeemAppCode(code, { host: HOST, label: LABEL, now: atExpiry })).toBeNull();
    // And a code redeemed one tick earlier would have worked.
    const other = mint();
    expect(redeemAppCode(other, { host: HOST, label: LABEL, now: atExpiry - 1 })).not.toBeNull();
  });

  it("is bound to the exact app host it was minted for", () => {
    const code = mint();
    expect(redeemAppCode(code, { host: "other.office.example", label: LABEL, now: 1_000_100 })).toBeNull();
  });

  it("is bound to the label, so a code cannot be moved between apps", () => {
    const code = mint({ label: "other", appHost: "other.office.example" });
    expect(redeemAppCode(code, { host: "other.office.example", label: LABEL, now: 1_000_100 })).toBeNull();
  });

  it("refuses malformed codes without touching the table", () => {
    const code = mint();
    for (const bogus of [null, "", "not base64url!", "has space", "a".repeat(65), `${code}=`]) {
      expect(redeemAppCode(bogus, { host: HOST, label: LABEL, now: 1_000_100 })).toBeNull();
    }
    // The real code still works: none of the above consumed it.
    expect(redeemAppCode(code, { host: HOST, label: LABEL, now: 1_000_100 })).not.toBeNull();
  });

  it("consumes a valid code even when the redeem budget is spent", () => {
    // This is the test that pins DELETE-BEFORE-LIMITER, and it has to look at the
    // table to do it: both orders REFUSE the over-budget presentation, so the only
    // observable difference is whether the code is still sitting there afterwards,
    // replayable once the window rolls. (Waiting for the window is not an option -
    // by then the code has expired for an unrelated reason, which is exactly how
    // the weaker version of this test passed.)
    const code = mint();
    expect(_testPendingCodeCount()).toBe(1);
    for (let i = 0; i < APP_REDEEM_MAX_PER_WINDOW; i++) {
      redeemAppCode("Zm9vYmFy", { host: HOST, label: LABEL, now: 1_000_050 });
    }
    expect(redeemAppCode(code, { host: HOST, label: LABEL, now: 1_000_050 })).toBeNull();
    expect(_testPendingCodeCount()).toBe(0);
  });

  it("rate-limits minting per office session", () => {
    const args = { label: LABEL, hostGen: 1, appHost: HOST, officeSessionHash: SESSION_HASH, returnPath: "/" };
    for (let i = 0; i < APP_MINT_MAX_PER_WINDOW; i++) {
      expect(mintAppCode(args, 1_000_000)).toHaveProperty("code");
    }
    expect(mintAppCode(args, 1_000_000)).toEqual({ error: "rate_limited" });
    // Another session is unaffected, and the window rolls.
    expect(mintAppCode({ ...args, officeSessionHash: "b".repeat(64) }, 1_000_000)).toHaveProperty("code");
    expect(mintAppCode(args, 1_000_000 + 60_000)).toHaveProperty("code");
  });

  it("refuses to mint rather than evict when the code table is full", () => {
    let lastError: string | null = null;
    for (let i = 0; i < 600; i++) {
      const res = mintAppCode({ label: LABEL, hostGen: 1, appHost: HOST, officeSessionHash: `s${i}`.padEnd(64, "0"), returnPath: "/" }, 1_000_000);
      if ("error" in res) {
        lastError = res.error;
        break;
      }
    }
    expect(lastError).toBe("no_capacity");
  });
});

describe("app sessions", () => {
  it("caps its own lifetime by the office session's absolute expiry", () => {
    const now = 1_000_000;
    const long = startAppSession({ label: LABEL, hostGen: 1, officeSessionHash: SESSION_HASH, absoluteExpiresAt: ABSOLUTE }, now);
    expect(long?.maxAgeSec).toBe(APP_SESSION_TTL_MS / 1000);
    const short = startAppSession({ label: LABEL, hostGen: 1, officeSessionHash: SESSION_HASH, absoluteExpiresAt: now + 30_000 }, now);
    expect(short?.maxAgeSec).toBe(30);
  });

  it("fails rather than issuing a cookie the browser deletes on arrival", () => {
    const now = 1_000_000;
    for (const absoluteExpiresAt of [now, now + 999, now - 1]) {
      expect(startAppSession({ label: LABEL, hostGen: 1, officeSessionHash: SESSION_HASH, absoluteExpiresAt }, now)).toBeNull();
    }
  });

  it("validates a live session for the app it was minted for", () => {
    officeSaysYes();
    const started = startAppSession({ label: LABEL, hostGen: 1, officeSessionHash: SESSION_HASH, absoluteExpiresAt: ABSOLUTE }, 1_000_000);
    expect(validateAppSession(started!.token, { app: APP, now: 1_000_100 })).toBe(true);
  });

  it("refuses a cookie whose office session is gone", () => {
    // The default resolver is the real store, and SESSION_HASH names no session
    // in it - so validation fails at the office revalidation step even though
    // every other field matches. This is what makes signing out of the office
    // close every app with it.
    const started = startAppSession({ label: LABEL, hostGen: 1, officeSessionHash: SESSION_HASH, absoluteExpiresAt: ABSOLUTE }, 1_000_000);
    expect(started).not.toBeNull();
    expect(validateAppSession(started!.token, { app: APP, now: 1_000_100 })).toBe(false);
  });

  it("refuses a cookie whose office session no longer permits the app", () => {
    // A demotion, or an app that is somebody else's: the office session is alive,
    // so the row survives, but the answer is no from this request on.
    officeSaysYes({ userId: "u-bob" });
    const started = startAppSession({ label: LABEL, hostGen: 1, officeSessionHash: SESSION_HASH, absoluteExpiresAt: ABSOLUTE }, 1_000_000);
    expect(validateAppSession(started!.token, { app: APP, now: 1_000_100 })).toBe(false);
    // The same cookie works again the moment the permit does - it was never
    // deleted, because a demotion is not orphaning.
    officeSaysYes();
    expect(validateAppSession(started!.token, { app: APP, now: 1_000_100 })).toBe(true);
  });

  it("is bound to the app's label AND generation", () => {
    officeSaysYes();
    const started = startAppSession({ label: LABEL, hostGen: 1, officeSessionHash: SESSION_HASH, absoluteExpiresAt: ABSOLUTE }, 1_000_000);
    expect(validateAppSession(started!.token, { app: { ...APP, hostLabel: "other" }, now: 1_000_100 })).toBe(false);
    expect(validateAppSession(started!.token, { app: { ...APP, hostGen: 2 }, now: 1_000_100 })).toBe(false);
  });

  it("expires, and drops the row when it does", () => {
    officeSaysYes();
    const started = startAppSession({ label: LABEL, hostGen: 1, officeSessionHash: SESSION_HASH, absoluteExpiresAt: 1_000_000 + 30_000 }, 1_000_000);
    expect(validateAppSession(started!.token, { app: APP, now: 1_030_000 })).toBe(false);
    expect(validateAppSession(started!.token, { app: APP, now: 1_000_100 })).toBe(false);
  });

  it("refuses malformed and unknown cookie values", () => {
    officeSaysYes();
    for (const bogus of [null, "", "not base64url!", "a".repeat(65)]) {
      expect(validateAppSession(bogus, { app: APP, now: 1_000_100 })).toBe(false);
    }
  });
});

describe("the app cookie", () => {
  const read = (cookie: string) => readAppCookie(new Request(`https://${HOST}/`, { headers: { cookie } }));

  it("reads its own name and ignores everything else", () => {
    expect(read(`${APP_COOKIE_NAME}=abc`)).toBe("abc");
    expect(read(`other=1; ${APP_COOKIE_NAME}=abc; more=2`)).toBe("abc");
    // An office session cookie is invisible to this arm, under either name: an
    // app origin can neither read nor mint one.
    expect(read("bureau_session=abc")).toBeNull();
    expect(read("__Host-bureau_session=abc")).toBeNull();
    // PRESENT with an empty value is "" and not null: it never authenticates, but
    // it is something in the browser that has to be cleared.
    expect(read(`${APP_COOKIE_NAME}=`)).toBe("");
    expect(read("")).toBeNull();
  });

  it("takes the FIRST occurrence of its name, never a later duplicate", () => {
    // RFC 6265 has the browser send the more specific match first; a later
    // duplicate injected by anything else must not displace it.
    expect(read(`${APP_COOKIE_NAME}=real; ${APP_COOKIE_NAME}=fake`)).toBe("real");
  });

  it("clears with the attributes the __Host- prefix requires", () => {
    expect(appCookieClearLine()).toBe(`${APP_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`);
  });
});
