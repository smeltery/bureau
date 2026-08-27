import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { _testResetApiTokens } from "../../auth/api-tokens.ts";
import { API_TOKENS_FILE } from "../../persistence/paths.ts";
import { claimUserByName, deleteUserById, getUserByName } from "../../users.ts";
import { handleApiTokensRequest } from "../../auth/api-tokens-route.ts";

const USERNAME = "API Token Route Tester";

beforeEach(reset);
afterEach(reset);

function reset() {
  _testResetApiTokens();
  const existing = getUserByName(USERNAME);
  if (existing) deleteUserById(existing.id);
  try {
    unlinkSync(API_TOKENS_FILE);
  } catch {}
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://local.test${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

function auth(userId: string): AuthResult {
  return {
    kind: "ok",
    session: { sessionIdHash: "hash", sessionPrefix: "sess", userId, username: USERNAME, role: "member", needsRolling: false, absoluteExpiresAt: Date.now() + 86_400_000 },
  };
}

describe("handleApiTokensRequest", () => {
  test("mints, lists, and revokes caller-owned API tokens", async () => {
    const user = claimUserByName(USERNAME, { role: "member", allowedRooms: [] });
    const createReq = request("/api/api-tokens", {
      method: "POST",
      body: JSON.stringify({ name: "automation", expiresInDays: 365 }),
    });

    const created = await handleApiTokensRequest(createReq, new URL(createReq.url), auth(user.id));
    expect(created?.status).toBe(201);
    const createBody = await created!.json();
    expect(createBody.token).toStartWith("bureau_pat_");
    expect(createBody.apiToken.name).toBe("automation");

    const listReq = request("/api/api-tokens", { method: "GET" });
    const listed = await handleApiTokensRequest(listReq, new URL(listReq.url), auth(user.id));
    expect(await listed!.json()).toEqual({ apiTokens: [createBody.apiToken] });

    const deleteReq = request(`/api/api-tokens/${createBody.apiToken.id}`, { method: "DELETE" });
    const deleted = await handleApiTokensRequest(deleteReq, new URL(deleteReq.url), auth(user.id));
    expect(deleted?.status).toBe(204);
  });

  test("requires a browser or personal-token authenticated user", async () => {
    const req = request("/api/api-tokens", { method: "GET" });

    const res = await handleApiTokensRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "authenticated session required" });
  });
});
