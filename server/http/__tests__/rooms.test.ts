import { describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { handleRoomsRequest } from "../rooms.ts";

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

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://local.test${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

describe("handleRoomsRequest", () => {
  test("returns null for unrelated /api routes", async () => {
    const req = request("/api/tasks");

    await expect(handleRoomsRequest(req, new URL(req.url), ownerAuth)).resolves.toBeNull();
  });

  test("requires a browser session for room routes", async () => {
    const req = request("/api/rooms", {
      method: "POST",
      body: JSON.stringify({ name: "Planning" }),
    });

    const res = await handleRoomsRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "authenticated browser session required" });
  });

  test("requires owner access to create rooms", async () => {
    const req = request("/api/rooms", {
      method: "POST",
      body: JSON.stringify({ name: "Planning" }),
    });

    const res = await handleRoomsRequest(req, new URL(req.url), memberAuth);

    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "owner access required" });
  });

  test("validates room rename bodies before mutating", async () => {
    const req = request("/api/rooms/room-1", {
      method: "PATCH",
      body: JSON.stringify({ name: "   " }),
    });

    const res = await handleRoomsRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(422);
    expect(await res?.json()).toEqual({ error: "name is required" });
  });

  test("validates swap desk indexes", async () => {
    const req = request("/api/rooms/room-1/swap-desks", {
      method: "POST",
      body: JSON.stringify({ deskA: 0, deskB: 9 }),
    });

    const res = await handleRoomsRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(422);
    expect(await res?.json()).toEqual({ error: "deskA and deskB must be integers from 0 to 7" });
  });
});
