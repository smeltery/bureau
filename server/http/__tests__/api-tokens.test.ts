import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { _testResetApiTokens, mintApiToken, resolveApiToken } from "../../auth/api-tokens.ts";
import { agents } from "../../agents/state.ts";
import * as AgentManager from "../../agent-manager.ts";
import { API_TOKENS_FILE } from "../../persistence/paths.ts";
import { claimUserByName, deleteUserById, getUserByName, updateUserById } from "../../users.ts";
import { handleApiTokensRequest } from "../../auth/api-tokens-route.ts";
import { handleAgentsRequest } from "../agents.ts";
import { installAgent } from "./privileged-agent-fixture.ts";

const USERNAME = "API Token Route Tester";

beforeEach(reset);
afterEach(reset);

function reset() {
  _testResetApiTokens();
  const existing = getUserByName(USERNAME);
  if (existing) deleteUserById(existing.id);
  agents.clear();
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

    const user = claimUserByName(USERNAME, { role: "member", allowedRooms: [] });
    const minted = await mintApiToken({ userId: user.id, name: "automation", expiresInDays: 30 });
    const token = resolveApiToken(minted.token);
    if (!token) throw new Error("expected API token to resolve");
    const res = await handleApiTokensRequest(req, new URL(req.url), { kind: "api", token });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "authenticated session required" });
  });

  test("lists and messages only visible live agents", async () => {
    const user = claimUserByName(USERNAME, { role: "member", allowedRooms: [] });
    const visibleRoomId = AgentManager.getRooms()[0]!.id;
    const hiddenRoomId = AgentManager.createRoom("API token hidden");
    const hiddenRoom = AgentManager.getRooms().findIndex((room) => room.id === hiddenRoomId);
    updateUserById(user.id, { allowedRooms: [visibleRoomId] });
    installAgent("api-visible", 0, user.id);
    installAgent("api-hidden", hiddenRoom, user.id);
    const minted = await mintApiToken({ userId: user.id, name: "automation", expiresInDays: 30 });
    const token = resolveApiToken(minted.token);
    if (!token) throw new Error("expected API token to resolve");
    const apiAuth: AuthResult = { kind: "api", token };

    const listReq = request("/api/agents", { headers: { Authorization: `Bearer ${minted.token}` } });
    const list = await handleAgentsRequest(listReq, new URL(listReq.url), apiAuth);
    expect(list?.status).toBe(200);
    expect((await list!.json()).map((agent: { id: string }) => agent.id)).toEqual(["api-visible"]);

    const blocked = await handleAgentsRequest(
      request("/api/agents/api-visible/messages", { method: "POST", headers: { Authorization: `Bearer ${minted.token}` }, body: JSON.stringify({ text: "hi", sendNow: true }) }),
      new URL("http://local.test/api/agents/api-visible/messages"),
      apiAuth,
    );
    expect(blocked?.status).toBe(400);

    const hidden = await handleAgentsRequest(
      request("/api/agents/api-hidden/messages", { method: "POST", headers: { Authorization: `Bearer ${minted.token}` }, body: JSON.stringify({ text: "hi" }) }),
      new URL("http://local.test/api/agents/api-hidden/messages"),
      apiAuth,
    );
    expect(hidden?.status).toBe(403);

    AgentManager.closeRoom(hiddenRoomId);
  });
});
