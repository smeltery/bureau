import { describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import type { UserRecord } from "../../../shared/types.ts";
import { handleUsersRequest, type UsersHttpDeps } from "../users.ts";

const ownerAuth: AuthResult = {
  kind: "ok",
  session: {
    sessionIdHash: "hash",
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
    sessionIdHash: "hash",
    sessionPrefix: "sess",
    userId: "member-1",
    username: "Member",
    role: "member",
    needsRolling: false,
  },
};

const user: UserRecord = {
  id: "member-1",
  name: "Member",
  role: "member",
  envFile: null,
  memberPrompt: null,
  language: null,
  allowedRooms: ["room-1"],
  hidden: [],
  order: [],
  defaultRoomId: "room-1",
  notifRooms: ["room-1"],
  avatarColor: "#0ea5e9",
  avatarVariant: "classic",
  createdAt: 1,
};

const deps: UsersHttpDeps = {
  update: async () => ({ ok: true, user }),
  setAccess: async () => ({ ok: true, user }),
  delete: async () => ({ ok: true }),
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

describe("handleUsersRequest", () => {
  test("returns null for unrelated api routes", async () => {
    const req = request("/api/office/settings");

    await expect(handleUsersRequest(req, new URL(req.url), ownerAuth, deps)).resolves.toBeNull();
  });

  test("requires a browser session", async () => {
    const req = request("/api/users/Member", { method: "PATCH", body: JSON.stringify({ name: "Member" }) });

    const res = await handleUsersRequest(req, new URL(req.url), { kind: "loopback" }, deps);

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "authenticated browser session required" });
  });

  test("validates update field types", async () => {
    const req = request("/api/users/Member", { method: "PATCH", body: JSON.stringify({ name: "" }) });

    const res = await handleUsersRequest(req, new URL(req.url), memberAuth, deps);

    expect(res?.status).toBe(422);
    expect(await res?.json()).toEqual({ error: "name cannot be empty" });
  });

  test("updates user record fields", async () => {
    const req = request("/api/users/Member", {
      method: "PATCH",
      body: JSON.stringify({ name: "Member Two", role: "owner", allowedRooms: ["room-2"], envFile: null, language: "es" }),
    });
    let updated: Parameters<UsersHttpDeps["update"]> | null = null;

    const res = await handleUsersRequest(req, new URL(req.url), ownerAuth, {
      ...deps,
      update: async (...args) => {
        updated = args;
        return { ok: true, user };
      },
    });

    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ user });
    expect(JSON.stringify(updated)).toBe(JSON.stringify(["owner-1", "owner", "Member", { name: "Member Two", envFile: null, language: "es" }]));
  });

  test("rejects unsupported language updates", async () => {
    const req = request("/api/users/Member", { method: "PATCH", body: JSON.stringify({ language: "fr" }) });

    const res = await handleUsersRequest(req, new URL(req.url), memberAuth, deps);

    expect(res?.status).toBe(422);
    expect(await res?.json()).toEqual({ error: "language must be supported or null" });
  });

  test("requires owner access to update room grants", async () => {
    const req = request("/api/users/Member/access", { method: "PUT", body: JSON.stringify({ allowedRooms: ["room-1"] }) });

    const res = await handleUsersRequest(req, new URL(req.url), memberAuth, deps);

    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "owner access required" });
  });

  test("updates room grants", async () => {
    const req = request("/api/users/Member/access", { method: "PUT", body: JSON.stringify({ allowedRooms: ["room-1"] }) });
    let setAccess: Parameters<UsersHttpDeps["setAccess"]> | null = null;

    const res = await handleUsersRequest(req, new URL(req.url), ownerAuth, {
      ...deps,
      setAccess: async (...args) => {
        setAccess = args;
        return { ok: true, user };
      },
    });

    expect(res?.status).toBe(200);
    expect(JSON.stringify(setAccess)).toBe(JSON.stringify(["owner-1", "Member", ["room-1"]]));
  });

  test("deletes users by username", async () => {
    const req = request("/api/users/Member", { method: "DELETE" });
    let deleted: Parameters<UsersHttpDeps["delete"]> | null = null;

    const res = await handleUsersRequest(req, new URL(req.url), ownerAuth, {
      ...deps,
      delete: async (...args) => {
        deleted = args;
        return { ok: true };
      },
    });

    expect(res?.status).toBe(204);
    expect(JSON.stringify(deleted)).toBe(JSON.stringify(["owner-1", "owner", "Member"]));
  });
});
