import { describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { handleInvitesRequest, type InvitesHttpDeps } from "../invites.ts";

const ownerAuth: AuthResult = {
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

const memberAuth: AuthResult = {
  kind: "ok",
  session: {
    sessionIdHash: "hash-2",
    sessionPrefix: "sess",
    userId: "member-1",
    username: "Member",
    role: "member",
    needsRolling: false,
  },
};

const invite = {
  tokenPrefix: "abcd1234",
  username: "Member",
  role: "member" as const,
  createdBy: "Owner",
  createdAt: 1,
  expiresAt: 2,
};

const deps: InvitesHttpDeps = {
  list: () => [],
  mint: async () => ({ ok: true, url: "http://local.test/i/token", invite }),
  mintSelf: async () => ({ ok: true, url: "http://local.test/i/token", invite }),
  revoke: async () => "ok",
};

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://local.test${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

describe("handleInvitesRequest", () => {
  test("returns null for unrelated api routes", async () => {
    const req = request("/api/tasks");

    await expect(handleInvitesRequest(req, new URL(req.url), ownerAuth, deps)).resolves.toBeNull();
  });

  test("requires a browser session", async () => {
    const req = request("/api/invites");

    const res = await handleInvitesRequest(req, new URL(req.url), { kind: "loopback" }, deps);

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "unauthenticated" });
  });

  test("lists invites scoped to the caller", async () => {
    const req = request("/api/invites");
    let listedFor: [string, "owner" | "member"] | null = null;

    const res = await handleInvitesRequest(req, new URL(req.url), memberAuth, {
      ...deps,
      list: (username, role) => {
        listedFor = [username, role];
        return [invite];
      },
    });

    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ invites: [invite] });
    expect(JSON.stringify(listedFor)).toBe(JSON.stringify(["Member", "member"]));
  });

  test("requires owner access to mint third-party invites", async () => {
    const req = request("/api/invites", {
      method: "POST",
      body: JSON.stringify({ username: "Guest", role: "member" }),
    });

    const res = await handleInvitesRequest(req, new URL(req.url), memberAuth, deps);

    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "owner access required" });
  });

  test("mints owner-created invites", async () => {
    const req = request("/api/invites", {
      method: "POST",
      body: JSON.stringify({ username: "Guest", role: "member", allowExisting: true, allowedRooms: ["room-1"] }),
    });
    let minted: Parameters<InvitesHttpDeps["mint"]>[0] | null = null;

    const res = await handleInvitesRequest(req, new URL(req.url), ownerAuth, {
      ...deps,
      mint: async (input) => {
        minted = input;
        return { ok: true, url: "http://local.test/i/token", invite };
      },
    });

    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ url: "http://local.test/i/token", invite });
    expect(JSON.stringify(minted)).toBe(JSON.stringify({ username: "Guest", role: "member", allowExisting: true, createdBy: "Owner", allowedRooms: ["room-1"] }));
  });

  test("rejects malformed invite room grants", async () => {
    const req = request("/api/invites", {
      method: "POST",
      body: JSON.stringify({ username: "Guest", role: "member", allowedRooms: "room-1" }),
    });

    const res = await handleInvitesRequest(req, new URL(req.url), ownerAuth, deps);

    expect(res?.status).toBe(400);
    expect(await res?.json()).toEqual({ error: "allowedRooms must be an array of room ids" });
  });

  test("mints self invites from the caller identity", async () => {
    const req = request("/api/invites/self", { method: "POST" });
    let minted: Parameters<InvitesHttpDeps["mintSelf"]>[0] | null = null;

    const res = await handleInvitesRequest(req, new URL(req.url), memberAuth, {
      ...deps,
      mintSelf: async (input) => {
        minted = input;
        return { ok: true, url: "http://local.test/i/token", invite };
      },
    });

    expect(res?.status).toBe(200);
    expect(JSON.stringify(minted)).toBe(JSON.stringify({ username: "Member", role: "member", createdBy: "Member" }));
  });

  test("revokes invites by prefix", async () => {
    const req = request("/api/invites/abcd1234", { method: "DELETE" });
    let revoked: [string, "owner" | "member", string] | null = null;

    const res = await handleInvitesRequest(req, new URL(req.url), memberAuth, {
      ...deps,
      revoke: async (...args) => {
        revoked = args;
        return "ok";
      },
    });

    expect(res?.status).toBe(204);
    expect(JSON.stringify(revoked)).toBe(JSON.stringify(["Member", "member", "abcd1234"]));
  });

  test("maps ambiguous revoke prefixes to conflict", async () => {
    const req = request("/api/invites/abcd1234", { method: "DELETE" });

    const res = await handleInvitesRequest(req, new URL(req.url), ownerAuth, {
      ...deps,
      revoke: async () => "ambiguous",
    });

    expect(res?.status).toBe(409);
    expect(await res?.json()).toEqual({ error: "ambiguous invite prefix" });
  });
});
