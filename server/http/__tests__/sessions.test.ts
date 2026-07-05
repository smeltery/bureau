import { describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { handleSessionsRequest, type SessionsHttpDeps } from "../sessions.ts";

const auth: AuthResult = {
  kind: "ok",
  session: {
    sessionIdHash: "hash-1",
    sessionPrefix: "sess",
    userId: "owner-1",
    username: "Owner",
    role: "owner",
    needsRolling: false,
  },
};

const deps: SessionsHttpDeps = {
  list: () => [],
  revoke: async () => "ok",
  logout: async () => "ok",
};

describe("handleSessionsRequest", () => {
  test("returns null for unrelated api routes", async () => {
    const req = new Request("http://local.test/api/tasks");

    await expect(handleSessionsRequest(req, new URL(req.url), auth, deps)).resolves.toBeNull();
  });

  test("requires a browser session", async () => {
    const req = new Request("http://local.test/api/sessions");

    const res = await handleSessionsRequest(req, new URL(req.url), { kind: "loopback" }, deps);

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "unauthenticated" });
  });

  test("lists scoped active sessions", async () => {
    const req = new Request("http://local.test/api/sessions");
    let listedFor: [string, "owner" | "member"] | null = null;

    const res = await handleSessionsRequest(req, new URL(req.url), auth, {
      ...deps,
      list: (userId, role) => {
        listedFor = [userId, role];
        return [];
      },
    });

    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ sessions: [] });
    expect(JSON.stringify(listedFor)).toBe(JSON.stringify(["owner-1", "owner"]));
  });

  test("revokes sessions by prefix", async () => {
    const req = new Request("http://local.test/api/sessions/sess-123", { method: "DELETE" });
    let revoked: [string, "owner" | "member", string] | null = null;

    const res = await handleSessionsRequest(req, new URL(req.url), auth, {
      ...deps,
      revoke: async (...args) => {
        revoked = args;
        return "ok";
      },
    });

    expect(res?.status).toBe(204);
    expect(JSON.stringify(revoked)).toBe(JSON.stringify(["owner-1", "owner", "sess-123"]));
  });

  test("logs out the current session", async () => {
    const req = new Request("http://local.test/api/sessions/current", { method: "DELETE" });
    let loggedOutHash: string | null = null;

    const res = await handleSessionsRequest(req, new URL(req.url), auth, {
      ...deps,
      logout: async (hash) => {
        loggedOutHash = hash;
        return "ok";
      },
    });

    expect(res?.status).toBe(204);
    expect(JSON.stringify(loggedOutHash)).toBe(JSON.stringify("hash-1"));
  });

  test("maps last-owner lockout to conflict", async () => {
    const req = new Request("http://local.test/api/sessions/current", { method: "DELETE" });

    const res = await handleSessionsRequest(req, new URL(req.url), auth, {
      ...deps,
      logout: async () => "would_strand_office",
    });

    expect(res?.status).toBe(409);
    expect(await res?.json()).toEqual({ error: "would leave office without an active owner session" });
  });
});
