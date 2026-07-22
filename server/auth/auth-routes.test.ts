import { describe, expect, test } from "bun:test";
import { COOKIE_NAME } from "./auth.ts";
import { inviteErrorResponse } from "./auth-routes.ts";

const sessionLookup = {
  sessionIdHash: "hash",
  sessionPrefix: "prefix",
  userId: "user-1",
  username: "Boss",
  role: "owner" as const,
  needsRolling: false,
};

function requestWithCookie(cookie = "session-raw"): Request {
  return new Request("http://local.test/i/token", {
    headers: { Cookie: `${COOKIE_NAME}=${cookie}` },
  });
}

describe("inviteErrorResponse", () => {
  test("redirects a signed-in browser away from an already-consumed invite", () => {
    const res = inviteErrorResponse(requestWithCookie(), "consumed", null, {
      readSessionCookie: () => "session-raw",
      validateSession: () => sessionLookup,
    });

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });

  test("keeps consumed invite errors for anonymous visitors", async () => {
    const res = inviteErrorResponse(requestWithCookie(), "consumed", null, {
      readSessionCookie: () => "session-raw",
      validateSession: () => null,
    });

    expect(res.status).toBe(410);
    expect(await res.text()).toContain("This invite has already been used.");
  });

  test("does not redirect other invite errors for signed-in visitors", async () => {
    const res = inviteErrorResponse(requestWithCookie(), "expired", null, {
      readSessionCookie: () => "session-raw",
      validateSession: () => sessionLookup,
    });

    expect(res.status).toBe(410);
    expect(await res.text()).toContain("This invite has expired.");
  });
});
