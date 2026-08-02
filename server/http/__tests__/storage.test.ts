import { describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { handleStorageRequest } from "../storage.ts";

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

describe("handleStorageRequest", () => {
  test("returns null for unrelated routes", () => {
    const req = new Request("http://local.test/api/tasks");

    expect(handleStorageRequest(req, new URL(req.url), ownerAuth)).toBeNull();
  });

  test("requires a browser session", async () => {
    const req = new Request("http://local.test/api/storage/usage");

    const res = handleStorageRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "unauthenticated" });
  });

  test("requires owner access", async () => {
    const req = new Request("http://local.test/api/storage/usage");

    const res = handleStorageRequest(req, new URL(req.url), memberAuth);

    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "owner access required" });
  });

  test("returns storage usage for owners", async () => {
    const req = new Request("http://local.test/api/storage/usage");

    const res = handleStorageRequest(req, new URL(req.url), ownerAuth);
    const body = await res?.json();

    expect(res?.status).toBe(200);
    expect(body.stateRoot).toBeString();
    expect(body.stateRootBytes).toBeNumber();
    expect(body.categories.map((category: { id: string }) => category.id)).toEqual(["transcripts", "attachments", "metadata", "cronjobs", "other-state", "backups"]);
  });
});
