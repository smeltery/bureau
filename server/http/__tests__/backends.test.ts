import { describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { handleBackendsRequest } from "../backends.ts";

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

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://local.test${path}`, init);
}

describe("handleBackendsRequest", () => {
  test("returns null for unrelated /api routes", async () => {
    const req = request("/api/validate/cwd");

    await expect(handleBackendsRequest(req, new URL(req.url), ownerAuth)).resolves.toBeNull();
  });

  test("requires a browser session for backend routes", async () => {
    const req = request("/api/backends/claude/models");

    const res = await handleBackendsRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ models: [], error: "authenticated browser session required" });
  });

  test("returns Claude backend models", async () => {
    const req = request(`/api/backends/claude/models?cwd=${encodeURIComponent(process.cwd())}`);

    const res = await handleBackendsRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(200);
    const body = await res?.json();
    expect(body.models.length).toBeGreaterThan(0);
    expect(body.models[0]).toHaveProperty("id");
    expect(body.models[0]).toHaveProperty("label");
    expect(body.models[0]).toHaveProperty("supportedEfforts");
  });

  test("rejects unknown backend names", async () => {
    const req = request("/api/backends/other/models");

    const res = await handleBackendsRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({ models: [], error: "unknown backend" });
  });

  test("returns cwd validation errors before listing models", async () => {
    const req = request("/api/backends/claude/models?cwd=/definitely/not/a/real/directory");

    const res = await handleBackendsRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(200);
    const body = await res?.json();
    expect(body.models).toEqual([]);
    expect(body.error).toContain("Directory does not exist");
  });
});
