import { afterAll, afterEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import * as AgentManager from "../../agent-manager.ts";
import type { AgentInfo } from "../../../shared/types.ts";
import { claimUserByName, deleteUserById } from "../../users.ts";
import { handleAgentSpawnRequest } from "../agent-spawn-route.ts";
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
    absoluteExpiresAt: Date.now() + 86_400_000,
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
    absoluteExpiresAt: Date.now() + 86_400_000,
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
    expect(body).toEqual({ prompt: "Keep reviews short.", envFile: null, cwd: null, pet: null, skin: null, decor: null, version: body.version });
    expect(typeof body.version).toBe("string");
    AgentManager.setRoomSettings(room.id, null, null);
  });

  test("saves room pet choices with versioned room settings", async () => {
    const room = AgentManager.getRooms()[0]!;
    const current = await handleRoomsRequest(request(`/api/rooms/${room.id}/settings`), new URL(`http://local.test/api/rooms/${room.id}/settings`), ownerAuth);
    expect(current).not.toBeNull();
    const version = ((await current!.json()) as { version: string }).version;

    const saved = await handleRoomsRequest(
      request(`/api/rooms/${room.id}/settings`, {
        method: "PUT",
        body: JSON.stringify({ prompt: null, envFile: null, pet: { coat: "silver" }, version }),
      }),
      new URL(`http://local.test/api/rooms/${room.id}/settings`),
      ownerAuth,
    );

    expect(saved?.status).toBe(204);
    expect(AgentManager.getRoomSettings(room.id)?.pet).toEqual({ species: "cat", coat: "silver" });
    AgentManager.setRoomPet(room.id, null);
  });

  test("saves, validates and clears a room's default working folder", async () => {
    const room = AgentManager.getRooms()[0]!;
    const url = new URL(`http://local.test/api/rooms/${room.id}/settings`);
    const save = async (cwd: unknown) => {
      const current = await handleRoomsRequest(request(url.pathname), url, ownerAuth);
      const { version } = (await current!.json()) as { version: string };
      return handleRoomsRequest(request(url.pathname, { method: "PUT", body: JSON.stringify({ prompt: null, envFile: null, cwd, version }) }), url, ownerAuth);
    };
    const folder = mkdtempSync(join(tmpdir(), "bureau-room-cwd-"));
    try {
      expect((await save(folder))?.status).toBe(204);
      expect(AgentManager.getRoomSettings(room.id)?.cwd).toBe(folder);
      expect(AgentManager.roomDefaultCwd(room.id)).toBe(folder);

      for (const bad of ["relative/path", join(folder, "missing"), 42]) {
        const res = await save(bad);
        expect(res?.status).toBe(422);
        expect(AgentManager.getRoomSettings(room.id)?.cwd).toBe(folder);
      }

      expect((await save("  "))?.status).toBe(204);
      expect(AgentManager.getRoomSettings(room.id)?.cwd).toBeNull();
    } finally {
      AgentManager.setRoomCwd(room.id, null);
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test("saves room decor choices with versioned room settings", async () => {
    const room = AgentManager.getRooms()[0]!;
    const current = await handleRoomsRequest(request(`/api/rooms/${room.id}/settings`), new URL(`http://local.test/api/rooms/${room.id}/settings`), ownerAuth);
    expect(current).not.toBeNull();
    const version = ((await current!.json()) as { version: string }).version;

    const saved = await handleRoomsRequest(
      request(`/api/rooms/${room.id}/settings`, {
        method: "PUT",
        body: JSON.stringify({ prompt: null, envFile: null, decor: "minimal", version }),
      }),
      new URL(`http://local.test/api/rooms/${room.id}/settings`),
      ownerAuth,
    );

    expect(saved?.status).toBe(204);
    expect(AgentManager.getRoomSettings(room.id)?.decor).toBe("minimal");

    const latest = await handleRoomsRequest(request(`/api/rooms/${room.id}/settings`), new URL(`http://local.test/api/rooms/${room.id}/settings`), ownerAuth);
    expect(latest).not.toBeNull();
    const body = (await latest!.json()) as { decor: string | null; version: string };
    expect(body.decor).toBe("minimal");
    expect(body.version).not.toBe(version);

    AgentManager.setRoomDecor(room.id, null);
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

describe("agent creation in a room with a default folder", () => {
  const spawnOwner = claimUserByName("Spawn Room Owner", { role: "owner" });
  const spawnOwnerAuth: AuthResult = {
    kind: "ok",
    session: { sessionIdHash: "hash", sessionPrefix: "sess", userId: spawnOwner.id, username: "Spawn Room Owner", role: "owner", needsRolling: false, absoluteExpiresAt: Date.now() + 86_400_000 },
  };
  afterAll(() => deleteUserById(spawnOwner.id));

  const room = () => AgentManager.getRooms()[0]!;
  const spawnRequest = (body: Record<string, unknown>) =>
    handleAgentSpawnRequest(
      new Request("http://local.test/api/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Rae", roomId: room().id, desk: 0, ...body }) }),
      spawnOwnerAuth,
    );

  afterEach(() => AgentManager.setRoomCwd(room().id, null));

  test("an agent created without a cwd starts in its room's default folder", async () => {
    const folder = mkdtempSync(join(tmpdir(), "bureau-spawn-cwd-"));
    const spawn = spyOn(AgentManager, "spawn").mockResolvedValue({ id: "agent-rae" } as AgentInfo);
    try {
      AgentManager.setRoomCwd(room().id, folder);
      expect((await spawnRequest({}))?.status).toBe(201);
      expect(spawn.mock.calls[0]?.[1]).toBe(folder);

      // An explicit cwd still wins over the room's folder.
      expect((await spawnRequest({ cwd: tmpdir() }))?.status).toBe(201);
      expect(spawn.mock.calls[1]?.[1]).toBe(tmpdir());
    } finally {
      spawn.mockRestore();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  test("an agent created without a cwd in a room with no folder is refused", async () => {
    const spawn = spyOn(AgentManager, "spawn");
    try {
      const res = await spawnRequest({});
      expect(res.status).toBe(422);
      expect(await res.json()).toEqual({ error: "cwd is required when the room has no default folder" });
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      spawn.mockRestore();
    }
  });
});
