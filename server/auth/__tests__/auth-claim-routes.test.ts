// The first-boot ownership claim, which had no test.
//
// This is the one route that hands out the office: whoever POSTs it successfully
// becomes owner, with no invite and no prior credential. It is safe only because
// three layers agree the caller is local, and the two enforced in THIS file are
// the ones a refactor can quietly drop — the pre-claim 127.0.0.1 bind is in
// server startup, but `requestIsLoopback` covers an operator who widened the
// bind, and the strict same-origin check is what stops a page on another origin
// from walking a logged-out browser through the claim.
//
// Every test here asserts a refusal, and each refusal is verified to fail when
// its guard is removed. The success path is deliberately not exercised: it needs
// the office to have no owner, and this suite runs in one process with a shared
// state directory, so forcing that would mean deleting owners another test file
// created. Instead the owner_exists path is pinned, which is the same claim
// route's other security property — a second owner cannot be minted.
//
// What these tests do NOT establish, because the code cannot: a non-browser
// client on the same host can forge `Origin` to the exact loopback value. That
// is an inherent topology limit, documented in the handler and in
// docs/features/access-and-invites.md under "Bootstrap-window exposure". The
// mitigation is operator discipline (claim first, expose later), not code.

import { afterEach, describe, expect, test } from "bun:test";
import type { Server } from "bun";
import { claimUserByName, deleteUserById, hasOwner } from "../../users.ts";
import { securityHeaders } from "../auth-pages.ts";
import { isLoopbackOrigin, requestIsLoopback } from "../auth-request-guards.ts";
import { handleClaim, handleClaimForm, shouldShowClaimForm } from "../auth-claim-routes.ts";

const createdUserIds: string[] = [];

afterEach(() => {
  for (const id of createdUserIds.splice(0)) deleteUserById(id);
});

const PORT = process.env.PORT || "4000";
const LOOPBACK_ORIGIN = `http://127.0.0.1:${PORT}`;

/** A server stub that reports whatever peer address the test wants. */
function serverSeeing(address: string | null): Server<unknown> {
  return {
    requestIP: () => (address === null ? null : { address, family: "IPv4", port: 1234 }),
  } as unknown as Server<unknown>;
}

/** A server whose requestIP throws, as it does for an already-closed request. */
function serverThatThrows(): Server<unknown> {
  return {
    requestIP: () => {
      throw new Error("no peer");
    },
  } as unknown as Server<unknown>;
}

function claimRequest(headers: Record<string, string>, body = "name=Nil"): Request {
  return new Request("http://127.0.0.1/auth/claim", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body,
  });
}

/** Make sure the office has an owner, creating a throwaway one only if needed. */
function ensureOwnerExists() {
  if (hasOwner()) return;
  const owner = claimUserByName(`Claim Test Owner ${crypto.randomUUID()}`, { role: "owner" });
  createdUserIds.push(owner.id);
}

describe("shouldShowClaimForm", () => {
  test("only ever answers for a GET of the root path", () => {
    // Independent of ownership: a POST or a different path is never the form.
    expect(shouldShowClaimForm(new Request("http://local.test/", { method: "POST" }), new URL("http://local.test/"))).toBe(false);
    expect(shouldShowClaimForm(new Request("http://local.test/agents"), new URL("http://local.test/agents"))).toBe(false);
  });

  test("goes dead once the office has an owner", () => {
    ensureOwnerExists();

    expect(shouldShowClaimForm(new Request("http://local.test/"), new URL("http://local.test/"))).toBe(false);
  });
});

describe("isLoopbackOrigin", () => {
  test("accepts exactly the two loopback spellings on bureau's port", () => {
    expect(isLoopbackOrigin(`http://localhost:${PORT}`)).toBe(true);
    expect(isLoopbackOrigin(`http://127.0.0.1:${PORT}`)).toBe(true);
  });

  test("rejects another origin wearing a loopback-looking name", () => {
    expect(isLoopbackOrigin("http://localhost.evil.test:" + PORT)).toBe(false);
    expect(isLoopbackOrigin("http://evil.test:" + PORT)).toBe(false);
    // A different port is a different origin, and so is https.
    expect(isLoopbackOrigin("http://127.0.0.1:1")).toBe(false);
    expect(isLoopbackOrigin(`https://127.0.0.1:${PORT}`)).toBe(false);
    expect(isLoopbackOrigin("")).toBe(false);
    expect(isLoopbackOrigin("null")).toBe(false);
  });
});

describe("requestIsLoopback", () => {
  test("recognises the loopback spellings a peer can arrive as", () => {
    const req = new Request("http://127.0.0.1/auth/claim");
    for (const addr of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "127.0.0.5"]) {
      expect(requestIsLoopback(req, serverSeeing(addr))).toBe(true);
    }
  });

  test("an off-box peer is not loopback, and an unknown peer is refused rather than assumed", () => {
    const req = new Request("http://127.0.0.1/auth/claim");
    expect(requestIsLoopback(req, serverSeeing("10.0.0.4"))).toBe(false);
    expect(requestIsLoopback(req, serverSeeing("192.168.1.20"))).toBe(false);
    // Fails closed: no peer info, or a throw, means "not local".
    expect(requestIsLoopback(req, serverSeeing(null))).toBe(false);
    expect(requestIsLoopback(req, serverThatThrows())).toBe(false);
  });
});

describe("handleClaim", () => {
  test("refuses an off-box peer before looking at anything else", async () => {
    let onOwnerCreatedCalls = 0;
    const res = await handleClaim(claimRequest({ Origin: LOOPBACK_ORIGIN }), serverSeeing("203.0.113.9"), null, () => {
      onOwnerCreatedCalls++;
    });

    expect(res.status).toBe(403);
    expect(await res.text()).toBe("forbidden");
    expect(onOwnerCreatedCalls).toBe(0);
  });

  test("refuses a request with no Origin header at all", async () => {
    const res = await handleClaim(claimRequest({}), serverSeeing("127.0.0.1"), null, null);

    expect(res.status).toBe(403);
    expect(await res.text()).toBe("bad origin");
  });

  test("refuses a cross-origin POST from a local browser — the CSRF case", async () => {
    // The peer IS loopback here, which is exactly why the Origin check has to
    // exist: a page on another origin can make a logged-out browser POST this
    // form, and the packet arrives from 127.0.0.1 like any other tab.
    const res = await handleClaim(claimRequest({ Origin: "http://evil.test" }), serverSeeing("127.0.0.1"), null, null);

    expect(res.status).toBe(403);
    expect(await res.text()).toBe("bad origin");
  });

  test("both locality checks run before the form body is read", async () => {
    // A body that formData() cannot parse still yields the locality refusal,
    // not a parse error — the guards precede any use of the request.
    const bad = new Request("http://127.0.0.1/auth/claim", {
      method: "POST",
      headers: { "Content-Type": "multipart/form-data; boundary=nope", Origin: "http://evil.test" },
      body: "not-a-multipart-body",
    });

    const res = await handleClaim(bad, serverSeeing("127.0.0.1"), null, null);

    expect(res.status).toBe(403);
    expect(await res.text()).toBe("bad origin");
  });

  test("a local, same-origin claim cannot mint a SECOND owner", async () => {
    ensureOwnerExists();
    let onOwnerCreatedCalls = 0;

    const res = await handleClaim(claimRequest({ Origin: LOOPBACK_ORIGIN }, `name=Interloper ${crypto.randomUUID()}`), serverSeeing("127.0.0.1"), null, () => {
      onOwnerCreatedCalls++;
    });

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("already has an owner");
    // No cookie, so a refused claim cannot leave the caller holding a session.
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(onOwnerCreatedCalls).toBe(0);
  });
});

// The Referrer-Policy coupling, which lives here because the claim form is why
// it exists. `securityHeaders` sends `no-referrer` by default — right for pages
// reached by an invite URL, where the token is IN the URL and must not leak
// through the Referer header. The claim form is the one auth page with no token
// in its URL, and it must NOT send the header: Chrome couples `no-referrer` with
// `Origin: null` on top-level form POSTs, so the real browser submit would then
// fail handleClaim's strict same-origin check with 403 — the form would look
// broken to the person claiming a brand-new office.
describe("securityHeaders", () => {
  test("defaults to no-referrer, for the pages that do carry a token", () => {
    expect(securityHeaders()["Referrer-Policy"]).toBe("no-referrer");
    expect(securityHeaders({ tokenInUrl: true })["Referrer-Policy"]).toBe("no-referrer");
  });

  test("omits it when there is no token to leak", () => {
    expect(securityHeaders({ tokenInUrl: false })["Referrer-Policy"]).toBeUndefined();
  });

  test("the claim form really ships without it, which is the regression that bit", () => {
    const res = handleClaimForm(null);

    expect(res.status).toBe(200);
    expect(res.headers.get("Referrer-Policy")).toBeNull();
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  test("no HSTS is asserted on a plain-HTTP origin", () => {
    // buildPublicOrigin() reports http://localhost in-process (the office is
    // loopback-bound until an owner exists AND external access is on), so only
    // this direction is reachable here. It is the direction worth pinning
    // anyway: sending HSTS from a plain-HTTP office would pin the browser to
    // https for that host and lock the operator out of their own office.
    expect(securityHeaders()["Strict-Transport-Security"]).toBeUndefined();
  });
});
