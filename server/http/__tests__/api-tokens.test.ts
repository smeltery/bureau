import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "fs";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { _testResetApiTokens, mintApiToken, resolveApiToken } from "../../auth/api-tokens.ts";
import { _testResetAgentTokens, mintAgentToken } from "../../agents/tokens.ts";
import { agents } from "../../agents/state.ts";
import * as AgentManager from "../../agent-manager.ts";
import { API_TOKEN_LOGS_DIR, API_TOKENS_FILE } from "../../persistence/paths.ts";
import { claimUserByName, deleteUserById, getUserByName, updateUserById } from "../../users.ts";
import { handleApiTokensRequest } from "../../auth/api-tokens-route.ts";
import { handleAgentsRequest } from "../agents.ts";
import { apiTokenIdempotency } from "../idempotency.ts";
import { installAgent } from "./privileged-agent-fixture.ts";

const USERNAME = "API Token Route Tester";

beforeEach(reset);
afterEach(reset);

function reset() {
  _testResetApiTokens();
  apiTokenIdempotency._reset();
  _testResetAgentTokens();
  const existing = getUserByName(USERNAME);
  if (existing) deleteUserById(existing.id);
  agents.clear();
  try {
    rmSync(API_TOKENS_FILE, { force: true });
  } catch {}
  try {
    rmSync(API_TOKEN_LOGS_DIR, { recursive: true, force: true });
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

function auth(userId: string, role: "owner" | "member" = "member"): AuthResult {
  return {
    kind: "ok",
    session: { sessionIdHash: "hash", sessionPrefix: "sess", userId, username: USERNAME, role, needsRolling: false, absoluteExpiresAt: Date.now() + 86_400_000 },
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

  test("lets an owner list and revoke a member's tokens, and refuses members", async () => {
    const member = claimUserByName(USERNAME, { role: "member", allowedRooms: [] });
    const minted = await mintApiToken({ userId: member.id, name: "automation", expiresInDays: 30 });
    const base = `/api/users/${encodeURIComponent(USERNAME)}/api-tokens`;
    const owner = auth("owner-id", "owner");

    const refusedReq = request(base, { method: "GET" });
    expect((await handleApiTokensRequest(refusedReq, new URL(refusedReq.url), auth("someone-else")))?.status).toBe(403);

    const listReq = request(base, { method: "GET" });
    expect(await (await handleApiTokensRequest(listReq, new URL(listReq.url), owner))!.json()).toEqual({ apiTokens: [minted.apiToken] });

    const deleteReq = request(`${base}/${minted.apiToken.id}`, { method: "DELETE" });
    expect((await handleApiTokensRequest(deleteReq, new URL(deleteReq.url), owner))?.status).toBe(204);
    expect(resolveApiToken(minted.token)).toBeNull();
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

  test("lists and messages only visible live agents with a real outbound messageId", async () => {
    const user = claimUserByName(USERNAME, { role: "member", allowedRooms: [] });
    const visibleRoom = AgentManager.getRooms()[0]!;
    const visibleRoomId = visibleRoom.id;
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

    agents.get("api-visible")!.info.state = "thinking";
    const sent = await handleAgentsRequest(
      request("/api/agents/api-visible/messages", { method: "POST", headers: { Authorization: `Bearer ${minted.token}` }, body: JSON.stringify({ text: "off-office alert" }) }),
      new URL("http://local.test/api/agents/api-visible/messages"),
      apiAuth,
    );
    expect(sent?.status).toBe(200);
    const sentBody = await sent!.json();
    expect(typeof sentBody.messageId).toBe("string");
    expect(sentBody.messageId.length).toBeGreaterThan(0);
    expect(agents.get("api-visible")!.messageQueue[0]?.sender).toEqual({
      kind: "user",
      username: USERNAME,
      device: `API token "automation" (${minted.apiToken.id})`,
    });

    AgentManager.closeRoom(hiddenRoomId);
  });

  test("rejects clientMessageId for API token senders", async () => {
    const user = claimUserByName(USERNAME, { role: "member", allowedRooms: [] });
    updateUserById(user.id, { allowedRooms: [AgentManager.getRooms()[0]!.id] });
    installAgent("api-visible", 0, user.id);
    agents.get("api-visible")!.info.state = "thinking";
    const minted = await mintApiToken({ userId: user.id, name: "automation", expiresInDays: 30 });
    const token = resolveApiToken(minted.token);
    if (!token) throw new Error("expected API token to resolve");

    const res = await handleAgentsRequest(
      request("/api/agents/api-visible/messages", {
        method: "POST",
        headers: { Authorization: `Bearer ${minted.token}` },
        body: JSON.stringify({ text: "hi", clientMessageId: "client-1" }),
      }),
      new URL("http://local.test/api/agents/api-visible/messages"),
      { kind: "api", token },
    );
    expect(res?.status).toBe(400);
    expect(await res?.json()).toEqual({
      error: "clientMessageId is not supported for API token senders. Use Idempotency-Key.",
    });
  });

  test("logs bidirectional conversation order and supports idempotent drain/send", async () => {
    const user = claimUserByName(USERNAME, { role: "member", allowedRooms: [] });
    const visibleRoom = AgentManager.getRooms()[0]!;
    updateUserById(user.id, { allowedRooms: [visibleRoom.id] });
    installAgent("api-replier", 0, user.id);
    agents.get("api-replier")!.info.state = "thinking";
    const agentToken = mintAgentToken("api-replier", user.id, false);
    const minted = await mintApiToken({ userId: user.id, name: "phone", expiresInDays: 30 });
    const apiToken = resolveApiToken(minted.token);
    if (!apiToken) throw new Error("expected API token to resolve");
    const apiAuth: AuthResult = { kind: "api", token: apiToken };

    const sendBody = JSON.stringify({ text: "request once" });
    const sendReq = {
      method: "POST" as const,
      headers: { Authorization: `Bearer ${minted.token}`, "Idempotency-Key": "send-once", "Content-Type": "application/json" },
      body: sendBody,
    };
    const sent = await handleAgentsRequest(request("/api/agents/api-replier/messages", sendReq), new URL("http://local.test/api/agents/api-replier/messages"), apiAuth);
    expect(sent?.status).toBe(200);
    const sentBody = await sent!.json();
    expect(typeof sentBody.messageId).toBe("string");
    expect(sentBody.messageId.length).toBeGreaterThan(0);

    const replay = await handleAgentsRequest(request("/api/agents/api-replier/messages", sendReq), new URL("http://local.test/api/agents/api-replier/messages"), apiAuth);
    expect(replay?.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await replay!.json()).toEqual(sentBody);

    const conflict = await handleAgentsRequest(
      request("/api/agents/api-replier/messages", {
        method: "POST",
        headers: { Authorization: `Bearer ${minted.token}`, "Idempotency-Key": "send-once", "Content-Type": "application/json" },
        body: JSON.stringify({ text: "different" }),
      }),
      new URL("http://local.test/api/agents/api-replier/messages"),
      apiAuth,
    );
    expect(conflict?.status).toBe(409);

    const reply = await handleApiTokensRequest(
      request(`/api/api-token-inboxes/${minted.apiToken.id}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${agentToken}` },
        body: JSON.stringify({ text: "The report is ready." }),
      }),
      new URL(`http://local.test/api/api-token-inboxes/${minted.apiToken.id}/messages`),
      undefined,
    );
    expect(reply?.status).toBe(200);
    const replyBody = await reply!.json();
    expect(typeof replyBody.messageId).toBe("string");

    const drained = await handleApiTokensRequest(
      request("/api/me/api-token-inbox/drain", {
        method: "POST",
        headers: { Authorization: `Bearer ${minted.token}`, "Idempotency-Key": "drain-1" },
        body: JSON.stringify({ after: 0 }),
      }),
      new URL("http://local.test/api/me/api-token-inbox/drain"),
      apiAuth,
    );
    expect(drained?.status).toBe(200);
    const drainedBody = await drained!.json();
    expect(drainedBody.entries).toMatchObject([
      { direction: "to_agent", sequence: 1, id: sentBody.messageId, text: "request once", targetAgentId: "api-replier" },
      {
        direction: "from_agent",
        sequence: 2,
        id: replyBody.messageId,
        text: "The report is ready.",
        senderAgentId: "api-replier",
        senderAgentName: "Agent api-replier",
        senderRoomName: visibleRoom.name,
      },
    ]);
    expect(drainedBody.previouslyDrainedAt).toBeNull();
    expect(typeof drainedBody.drainedAt).toBe("number");
    expect(drainedBody.latestSequence).toBe(2);

    const drainReplay = await handleApiTokensRequest(
      request("/api/me/api-token-inbox/drain", {
        method: "POST",
        headers: { Authorization: `Bearer ${minted.token}`, "Idempotency-Key": "drain-1" },
        body: JSON.stringify({ after: 0 }),
      }),
      new URL("http://local.test/api/me/api-token-inbox/drain"),
      apiAuth,
    );
    expect(drainReplay?.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await drainReplay!.json()).toEqual(drainedBody);

    const again = await handleApiTokensRequest(
      request("/api/me/api-token-inbox/drain", {
        method: "POST",
        headers: { Authorization: `Bearer ${minted.token}` },
        body: JSON.stringify({ after: 0 }),
      }),
      new URL("http://local.test/api/me/api-token-inbox/drain"),
      apiAuth,
    );
    expect((await again!.json()).entries).toHaveLength(2);

    const after = await handleApiTokensRequest(
      request("/api/me/api-token-inbox/drain", {
        method: "POST",
        headers: { Authorization: `Bearer ${minted.token}` },
        body: JSON.stringify({ after: 2 }),
      }),
      new URL("http://local.test/api/me/api-token-inbox/drain"),
      apiAuth,
    );
    expect((await after!.json()).entries).toEqual([]);

    expect(AgentManager.getAgentLogs("api-replier").at(-1)).toMatchObject({
      kind: "api_token_outbound",
      content: "The report is ready.",
      metadata: { recipient_api_token_name: "phone" },
    });
  });

  test("CORS preflight allows Idempotency-Key", async () => {
    const req = request("/api/me/api-token-inbox/drain", { method: "OPTIONS" });
    const res = await handleApiTokensRequest(req, new URL(req.url), undefined);
    expect(res?.headers.get("Access-Control-Allow-Headers")).toContain("Idempotency-Key");
  });
});
