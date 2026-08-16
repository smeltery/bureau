import { afterEach, describe, expect, test } from "bun:test";

import { agents } from "../../agents/state.ts";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { handleUsageRequest } from "../usage.ts";

const ownerAuth: AuthResult = {
  kind: "ok",
  session: {
    sessionIdHash: "hash-1",
    sessionPrefix: "sess",
    userId: "missing-owner",
    username: "Owner",
    role: "owner",
    needsRolling: false,
    absoluteExpiresAt: Date.now() + 86_400_000,
  },
};

afterEach(() => agents.clear());

describe("handleUsageRequest", () => {
  test("returns null for unrelated routes", () => {
    const req = new Request("http://local.test/api/tasks");

    expect(handleUsageRequest(req, new URL(req.url), ownerAuth)).toBeNull();
  });

  test("requires a browser session", async () => {
    const req = new Request("http://local.test/api/usage");

    const res = handleUsageRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "unauthenticated" });
  });

  test("returns structured usage data", async () => {
    const req = new Request("http://local.test/api/usage");

    const res = handleUsageRequest(req, new URL(req.url), ownerAuth);
    const body = await res?.json();

    expect(res?.status).toBe(200);
    expect(body).toMatchObject({
      scoped: true,
      agents: [],
      rooms: [],
      total: {
        session: { totalIn: 0, cacheRead: 0, cacheCreation: 0, totalOut: 0, costUSD: 0 },
        lifetime: { totalIn: 0, cacheRead: 0, cacheCreation: 0, totalOut: 0, costUSD: 0 },
      },
    });
  });
});
