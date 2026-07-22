import { describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import * as AgentManager from "../../agent-manager.ts";
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

  test("returns room settings to authorized sessions", async () => {
    const room = AgentManager.getRooms()[0]!;
    AgentManager.setRoomSettings(room.id, "Keep reviews short.", null);
    const req = request(`/api/rooms/${room.id}/settings`);

    const res = await handleRoomsRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(200);
    const body = await res?.json();
    expect(body).toEqual({ prompt: "Keep reviews short.", envFile: null, version: body.version });
    expect(typeof body.version).toBe("string");
    AgentManager.setRoomSettings(room.id, null, null);
  });

  test("requires the current room settings version when saving", async () => {
    const room = AgentManager.getRooms()[0]!;
    AgentManager.setRoomSettings(room.id, "current", null);
    const current = await handleRoomsRequest(request(`/api/rooms/${room.id}/settings`), new URL(`http://local.test/api/rooms/${room.id}/settings`), ownerAuth);
    expect(current).not.toBeNull();
    const version = ((await current!.json()) as { version: string }).version;

    const missing = await handleRoomsRequest(
      request(`/api/rooms/${room.id}/settings`, {
        method: "PUT",
        body: JSON.stringify({ prompt: "next", envFile: null }),
      }),
      new URL(`http://local.test/api/rooms/${room.id}/settings`),
      ownerAuth,
    );
    expect(missing?.status).toBe(400);
    expect(await missing?.json()).toEqual({ error: "settings version is required" });
    expect(AgentManager.getRoomSettings(room.id)?.prompt).toBe("current");

    AgentManager.setRoomSettings(room.id, "newer", null);
    const stale = await handleRoomsRequest(
      request(`/api/rooms/${room.id}/settings`, {
        method: "PUT",
        body: JSON.stringify({ prompt: "stale write", envFile: null, version }),
      }),
      new URL(`http://local.test/api/rooms/${room.id}/settings`),
      ownerAuth,
    );
    expect(stale?.status).toBe(409);
    expect(await stale?.json()).toEqual({ error: "room settings changed; fetch the latest version and retry" });
    expect(AgentManager.getRoomSettings(room.id)?.prompt).toBe("newer");

    const latest = await handleRoomsRequest(request(`/api/rooms/${room.id}/settings`), new URL(`http://local.test/api/rooms/${room.id}/settings`), ownerAuth);
    expect(latest).not.toBeNull();
    const latestVersion = ((await latest!.json()) as { version: string }).version;
    const saved = await handleRoomsRequest(
      request(`/api/rooms/${room.id}/settings`, {
        method: "PUT",
        body: JSON.stringify({ prompt: "saved", envFile: null, version: latestVersion }),
      }),
      new URL(`http://local.test/api/rooms/${room.id}/settings`),
      ownerAuth,
    );
    expect(saved?.status).toBe(204);
    expect(AgentManager.getRoomSettings(room.id)?.prompt).toBe("saved");
    AgentManager.setRoomSettings(room.id, null, null);
  });

  test("returns not found for missing room settings after auth passes", async () => {
    const req = request("/api/rooms/missing/settings");

    const res = await handleRoomsRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({ error: "room not found" });
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
