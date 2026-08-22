import { describe, expect, test } from "bun:test";
import { COOKIE_NAME } from "./auth.ts";
import { inviteErrorResponse, inviteIdentityConflict } from "./auth-routes.ts";
import type { UserRecord } from "../../shared/types.ts";

const sessionLookup = {
  sessionIdHash: "hash",
  sessionPrefix: "prefix",
  userId: "user-1",
  username: "Boss",
  role: "owner" as const,
  needsRolling: false,
  absoluteExpiresAt: Date.now() + 86_400_000,
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

function user(id: string, name: string): UserRecord {
  return {
    id,
    name,
    role: "member",
    envFile: null,
    memberPrompt: null,
    language: null,
    slideMode: false,
    allowedRooms: [],
    hidden: [],
    order: [],
    defaultRoomId: null,
    notifRooms: [],
    avatarColor: "#88d1f0",
    avatarVariant: "classic",
    createdAt: 1,
  };
}

describe("inviteIdentityConflict", () => {
  test("refuses a signed-in browser accepting another user's invite", () => {
    const conflict = inviteIdentityConflict(requestWithCookie(), { needsName: false, username: "Alice", role: "member", bootstrap: false }, null, {
      readSessionCookie: () => "session-raw",
      validateSession: () => sessionLookup,
      getUserByName: (name) => (name === "Alice" ? user("user-2", "Alice") : null),
    });

    expect(conflict).toEqual({ current: "Boss", invitee: "Alice" });
  });

  test("allows a same-user recovery invite", () => {
    const conflict = inviteIdentityConflict(requestWithCookie(), { needsName: false, username: "Boss", role: "owner", bootstrap: false }, null, {
      readSessionCookie: () => "session-raw",
      validateSession: () => sessionLookup,
      getUserByName: (name) => (name === "Boss" ? user("user-1", "Boss") : null),
    });

    expect(conflict).toBeNull();
  });

  test("does not turn invalid bootstrap names into identity conflicts", () => {
    const conflict = inviteIdentityConflict(requestWithCookie(), { needsName: true, username: null, role: "owner", bootstrap: true }, "", {
      readSessionCookie: () => "session-raw",
      validateSession: () => sessionLookup,
      getUserByName: () => null,
    });

    expect(conflict).toBeNull();
  });
});
