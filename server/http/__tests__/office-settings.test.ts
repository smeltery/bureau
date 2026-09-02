import { describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { handleEnvSettingsRequest, handleOfficeSettingsRequest } from "../office-settings.ts";

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

describe("handleOfficeSettingsRequest", () => {
  test("returns null for unrelated /api routes", async () => {
    const req = request("/api/rooms");

    await expect(handleOfficeSettingsRequest(req, new URL(req.url), ownerAuth)).resolves.toBeNull();
  });

  test("requires a browser session for office settings routes", async () => {
    const req = request("/api/office/settings");

    const res = await handleOfficeSettingsRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "authenticated browser session required" });
  });

  test("requires owner access for office settings routes", async () => {
    const req = request("/api/office/settings");

    const res = await handleOfficeSettingsRequest(req, new URL(req.url), memberAuth);

    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "owner access required" });
  });

  test("returns office settings to owners", async () => {
    const req = request("/api/office/settings");

    const res = await handleOfficeSettingsRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(200);
    const body = await res?.json();
    expect(body).toHaveProperty("prompt");
    expect(body).toHaveProperty("envFile");
    expect(typeof body.prompt === "string" || body.prompt === null).toBe(true);
    expect(typeof body.envFile === "string" || body.envFile === null).toBe(true);
  });

  test("rejects invalid JSON before saving settings", async () => {
    const req = request("/api/office/settings", {
      method: "PUT",
      body: "not json",
    });

    const res = await handleOfficeSettingsRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(400);
    expect(await res?.json()).toEqual({ error: "invalid JSON" });
  });
});

describe("handleEnvSettingsRequest", () => {
  test("returns null for unrelated routes", async () => {
    const req = request("/api/users/Member");

    await expect(handleEnvSettingsRequest(req, new URL(req.url), ownerAuth)).resolves.toBeNull();
  });

  test("requires owner access for office env", async () => {
    const req = request("/api/office/env");

    const res = await handleEnvSettingsRequest(req, new URL(req.url), memberAuth);

    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "owner access required" });
  });

  test("rejects malformed value maps", async () => {
    const req = request("/api/office/env", { method: "PUT", body: JSON.stringify({ values: { OK: 1 } }) });

    const res = await handleEnvSettingsRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(400);
    expect(await res?.json()).toEqual({ error: "values must be a string map" });
  });
});
