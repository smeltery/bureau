import { describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { handleAccessRequest, type AccessHttpDeps } from "../access.ts";

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

const deps: AccessHttpDeps = {
  get: () => ({
    externalAccess: true,
    publicOrigin: "https://office.example",
    previewAllowHosts: ["staging.example.com"],
    envOriginSet: false,
    envOrigin: null,
    boundLoopback: false,
    officeName: "Office",
  }),
  set: async () => ({ ok: true, signInUrl: "https://office.example/i/token", restartRequired: true }),
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

describe("handleAccessRequest", () => {
  test("returns null for unrelated api routes", async () => {
    const req = request("/api/office/settings");

    await expect(handleAccessRequest(req, new URL(req.url), ownerAuth, deps)).resolves.toBeNull();
  });

  test("requires a browser session", async () => {
    const req = request("/api/office/access");

    const res = await handleAccessRequest(req, new URL(req.url), { kind: "loopback" }, deps);

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "authenticated browser session required" });
  });

  test("requires owner access", async () => {
    const req = request("/api/office/access");

    const res = await handleAccessRequest(req, new URL(req.url), memberAuth, deps);

    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "owner access required" });
  });

  test("returns access settings", async () => {
    const req = request("/api/office/access");

    const res = await handleAccessRequest(req, new URL(req.url), ownerAuth, deps);

    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({
      externalAccess: true,
      publicOrigin: "https://office.example",
      previewAllowHosts: ["staging.example.com"],
      envOriginSet: false,
      envOrigin: null,
      boundLoopback: false,
      officeName: "Office",
    });
  });

  test("requires an externalAccess boolean when saving", async () => {
    const req = request("/api/office/access", {
      method: "PUT",
      body: JSON.stringify({ publicOrigin: "https://office.example" }),
    });

    const res = await handleAccessRequest(req, new URL(req.url), ownerAuth, deps);

    expect(res?.status).toBe(400);
    expect(await res?.json()).toEqual({ error: "externalAccess (boolean) is required" });
  });

  test("saves access settings and returns the restart response", async () => {
    const req = request("/api/office/access", {
      method: "PUT",
      body: JSON.stringify({ externalAccess: true, publicOrigin: "https://office.example", previewAllowHosts: ["staging.example.com"] }),
    });
    let saved: { externalAccess: boolean; publicOrigin: string; previewAllowHosts: string[] } | null = null;

    const res = await handleAccessRequest(req, new URL(req.url), ownerAuth, {
      ...deps,
      set: async (input) => {
        saved = input;
        return { ok: true, signInUrl: "https://office.example/i/token", restartRequired: true };
      },
    });

    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({ signInUrl: "https://office.example/i/token", restartRequired: true });
    expect(JSON.stringify(saved)).toBe(JSON.stringify({ externalAccess: true, publicOrigin: "https://office.example", previewAllowHosts: ["staging.example.com"] }));
  });

  test("returns mapped save errors", async () => {
    const req = request("/api/office/access", {
      method: "PUT",
      body: JSON.stringify({ externalAccess: true, publicOrigin: "https://office.example" }),
    });

    const res = await handleAccessRequest(req, new URL(req.url), ownerAuth, {
      ...deps,
      set: async () => ({ ok: false, status: 409, error: "env mismatch", envOrigin: "https://env.example" }),
    });

    expect(res?.status).toBe(409);
    expect(await res?.json()).toEqual({ error: "env mismatch", envOrigin: "https://env.example" });
  });
});
