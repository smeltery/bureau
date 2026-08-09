import { describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { handleViewRequest, type ViewHttpDeps } from "../view.ts";

const auth: AuthResult = {
  kind: "ok",
  session: {
    sessionIdHash: "hash-1",
    sessionPrefix: "sess",
    userId: "owner-1",
    username: "Owner",
    role: "owner",
    needsRolling: false,
    absoluteExpiresAt: Date.now() + 86_400_000,
  },
};

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

    await expect(handleViewRequest(req, new URL(req.url), auth, { applyView: () => true })).resolves.toBeNull();
  });

  test("requires a browser session", async () => {
    const req = request("/api/me/view/order", {
      body: JSON.stringify({ order: [] }),
    });

    const res = await handleViewRequest(req, new URL(req.url), { kind: "loopback" }, { applyView: () => true });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "unauthenticated" });
  });

  test("validates room id list bodies", async () => {
    const req = request("/api/me/view/notif-rooms", {
      body: JSON.stringify({ notifRooms: "room-1" }),
    });

    const res = await handleViewRequest(req, new URL(req.url), auth, { applyView: () => true });

    expect(res?.status).toBe(422);
    expect(await res?.json()).toEqual({ error: "notifRooms must be an array of room ids" });
  });

  test("applies default room updates for the current user", async () => {
    let applied: [string, { defaultRoomId: string }] | null = null;
    const req = request("/api/me/view/default-room", {
      body: JSON.stringify({ defaultRoomId: "room-1" }),
    });

    const res = await handleViewRequest(req, new URL(req.url), auth, {
      applyView: (...args) => {
        applied = args as [string, { defaultRoomId: string }];
        return true;
      },
    });

    expect(res?.status).toBe(204);
    expect(JSON.stringify(applied)).toBe(JSON.stringify(["owner-1", { defaultRoomId: "room-1" }]));
  });
});
