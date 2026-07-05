import { describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { handleValidateRequest } from "../validate.ts";

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
    method: "POST",
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

describe("handleValidateRequest", () => {
  test("returns null for unrelated /api routes", async () => {
    const req = request("/api/office/settings");

    await expect(handleValidateRequest(req, new URL(req.url), ownerAuth)).resolves.toBeNull();
  });

  test("requires a browser session for validation routes", async () => {
    const req = request("/api/validate/cwd", {
      body: JSON.stringify({ cwd: process.cwd() }),
    });

    const res = await handleValidateRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ ok: false, error: "authenticated browser session required" });
  });

  test("validates existing working directories", async () => {
    const req = request("/api/validate/cwd", {
      body: JSON.stringify({ cwd: process.cwd() }),
    });

    const res = await handleValidateRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ ok: true });
  });

  test("rejects empty working directory probes", async () => {
    const req = request("/api/validate/cwd", {
      body: JSON.stringify({ cwd: "   " }),
    });

    const res = await handleValidateRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ ok: false, error: "cwd is required" });
  });

  test("requires owner access for office env validation", async () => {
    const req = request("/api/validate/env", {
      body: JSON.stringify({ scope: "office" }),
    });

    const res = await handleValidateRequest(req, new URL(req.url), memberAuth);

    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ ok: false, error: "owner access required" });
  });

  test("returns ok when a scope has no env file", async () => {
    const req = request("/api/validate/env", {
      body: JSON.stringify({ scope: "room", roomId: "missing-room" }),
    });

    const res = await handleValidateRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ ok: true });
  });

  test("rejects unknown env validation scopes", async () => {
    const req = request("/api/validate/env", {
      body: JSON.stringify({ scope: "other" }),
    });

    const res = await handleValidateRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(422);
    expect(await res?.json()).toEqual({ ok: false, error: "scope must be office, room, or user" });
  });
});
