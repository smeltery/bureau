import { afterEach, describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import * as AgentManager from "../../agent-manager.ts";
import { claimUserByName, deleteUserById, getUserById, updateUserById } from "../../users.ts";
import { applyViewPreference, listAccessibleRoomsForApi } from "../access-adapters.ts";
import { handleViewRequest, type ViewHttpDeps } from "../view.ts";

const createdUserIds: string[] = [];
const createdRoomIds: string[] = [];

afterEach(() => {
  for (const id of createdUserIds.splice(0)) deleteUserById(id);
  for (const id of createdRoomIds.splice(0)) AgentManager.closeRoom(id);
});

function sessionAuth(userId: string, username: string, role: "owner" | "member"): AuthResult {
  return {
    kind: "ok",
    session: {
      sessionIdHash: "hash-1",
      sessionPrefix: "sess",
      userId,
      username,
      role,
      needsRolling: false,
      absoluteExpiresAt: Date.now() + 86_400_000,
    },
  };
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://local.test${path}`, {
    method: "PUT",
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

describe("handleViewRequest", () => {
  test("returns null for unrelated api routes", async () => {
    const req = request("/api/tasks");

    await expect(
      handleViewRequest(req, new URL(req.url), sessionAuth("owner-1", "Owner", "owner"), {
        applyView: () => true,
        listAccessibleRooms: () => [],
      }),
    ).resolves.toBeNull();
  });

  test("requires a browser session", async () => {
    const req = request("/api/me/view/order", {
      body: JSON.stringify({ order: [] }),
    });

    const res = await handleViewRequest(
      req,
      new URL(req.url),
      { kind: "loopback" },
      {
        applyView: () => true,
        listAccessibleRooms: () => [],
      },
    );

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "unauthenticated" });
  });

  test("validates room id list bodies", async () => {
    const req = request("/api/me/view/notif-rooms", {
      body: JSON.stringify({ notifRooms: "room-1" }),
    });

    const res = await handleViewRequest(req, new URL(req.url), sessionAuth("owner-1", "Owner", "owner"), {
      applyView: () => true,
      listAccessibleRooms: () => [],
    });

    expect(res?.status).toBe(422);
    expect(await res?.json()).toEqual({ error: "notifRooms must be an array of room ids" });
  });

  test("applies default room updates for the current user", async () => {
    let applied: [string, { defaultRoomId: string }] | null = null;
    const req = request("/api/me/view/default-room", {
      body: JSON.stringify({ defaultRoomId: "room-1" }),
    });

    const res = await handleViewRequest(req, new URL(req.url), sessionAuth("owner-1", "Owner", "owner"), {
      applyView: (...args) => {
        applied = args as [string, { defaultRoomId: string }];
        return true;
      },
      listAccessibleRooms: () => [],
    });

    expect(res?.status).toBe(204);
    expect(JSON.stringify(applied)).toBe(JSON.stringify(["owner-1", { defaultRoomId: "room-1" }]));
  });

  test("accepts shown updates and lists accessible rooms including hidden", async () => {
    const deps: ViewHttpDeps = {
      applyView: () => true,
      listAccessibleRooms: () => [
        { id: "r1", name: "One" },
        { id: "r2", name: "Two" },
      ],
    };
    const auth = sessionAuth("member-1", "Mia", "member");

    const shownReq = request("/api/me/view/shown", { body: JSON.stringify({ shown: ["r1"] }) });
    expect((await handleViewRequest(shownReq, new URL(shownReq.url), auth, deps))?.status).toBe(204);

    const badShown = request("/api/me/view/shown", { body: JSON.stringify({ shown: "r1" }) });
    expect((await handleViewRequest(badShown, new URL(badShown.url), auth, deps))?.status).toBe(422);

    const listReq = new Request("http://local.test/api/me/rooms");
    const listRes = await handleViewRequest(listReq, new URL(listReq.url), auth, deps);
    expect(listRes?.status).toBe(200);
    expect(await listRes?.json()).toEqual({
      rooms: [
        { id: "r1", name: "One" },
        { id: "r2", name: "Two" },
      ],
    });
  });
});

describe("applyViewPreference shown + listAccessibleRoomsForApi", () => {
  test("setShown hides accessible rooms not listed and listRooms still returns them", () => {
    const r1 = AgentManager.getRooms()[0]?.id;
    expect(r1).toBeTruthy();
    const r2 = AgentManager.createRoom("Reshow R2");
    createdRoomIds.push(r2);
    const r3 = AgentManager.createRoom("Reshow R3");
    createdRoomIds.push(r3);

    const member = claimUserByName(`Reshow ${crypto.randomUUID()}`, { role: "member", allowedRooms: [r1!, r2] });
    createdUserIds.push(member.id);
    expect(updateUserById(member.id, { notifRooms: [r1!, r2] }).ok).toBe(true);

    expect(applyViewPreference(member.id, { shown: [r1!, "no-such-room"] })).toBe(true);
    expect(getUserById(member.id)?.hidden).toEqual([r2]);
    expect(getUserById(member.id)?.notifRooms).toEqual([r1!]);

    expect(applyViewPreference(member.id, { shown: [r1!, r2] })).toBe(true);
    expect(getUserById(member.id)?.hidden).toEqual([]);

    const listed = listAccessibleRoomsForApi(member.id);
    expect(listed?.map((room) => room.id).sort()).toEqual([r1!, r2].sort());
    expect(listed?.some((room) => room.id === r3)).toBe(false);
  });
});
