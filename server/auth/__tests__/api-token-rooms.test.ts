import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "fs";
import type { AuthResult } from "../auth-middleware.ts";
import { authenticate } from "../auth-middleware.ts";
import { _testResetApiTokens, enqueueApiTokenInboxMessage, mintApiToken, resolveApiToken } from "../api-tokens.ts";
import { apiTokenRoomLimitedPath } from "../api-token-rooms.ts";
import { handleApiTokensRequest } from "../api-tokens-route.ts";
import { agents } from "../../agents/state.ts";
import * as AgentManager from "../../agent-manager.ts";
import { API_TOKEN_LOGS_DIR, API_TOKENS_FILE } from "../../persistence/paths.ts";
import { claimUserByName, deleteUserById, getUserByName } from "../../users.ts";
import { handleAgentsRequest } from "../../http/agents.ts";
import { handleTasksRequest } from "../../http/tasks.ts";
import { tasks } from "../../ws/broadcast.ts";
import { installAgent } from "../../http/__tests__/privileged-agent-fixture.ts";

const USERNAME = "Room Token Tester";
let extraRoomId: string | null = null;

beforeEach(reset);
afterEach(reset);

function reset() {
  _testResetApiTokens();
  const existing = getUserByName(USERNAME);
  if (existing) deleteUserById(existing.id);
  agents.clear();
  tasks.length = 0;
  if (extraRoomId) AgentManager.closeRoom(extraRoomId);
  extraRoomId = null;
  rmSync(API_TOKENS_FILE, { force: true });
  rmSync(API_TOKEN_LOGS_DIR, { recursive: true, force: true });
}

const session = (userId: string, role: "owner" | "member"): AuthResult => ({
  kind: "ok",
  session: { sessionIdHash: "hash", sessionPrefix: "sess", userId, username: USERNAME, role, needsRolling: false, absoluteExpiresAt: Date.now() + 86_400_000 },
});

async function mintRoute(auth: AuthResult, body: Record<string, unknown>) {
  const req = new Request("http://local.test/api/api-tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "ci", expiresInDays: 30, ...body }) });
  return (await handleApiTokensRequest(req, new URL(req.url), auth))!;
}

// An owner with a second room: the owner sees both, the token only the first.
function officeWithTwoRooms() {
  const owner = claimUserByName(USERNAME, { role: "owner", allowedRooms: [] });
  const firstRoomId = AgentManager.getRooms()[0]!.id;
  extraRoomId = AgentManager.createRoom("Room token other");
  const otherIndex = AgentManager.getRooms().findIndex((room) => room.id === extraRoomId);
  installAgent("room-token-in", 0, owner.id);
  installAgent("room-token-out", otherIndex, owner.id);
  return { owner, firstRoomId, otherRoomId: extraRoomId };
}

test("a token is minted with rooms its member can see, and nothing else", async () => {
  const { owner, firstRoomId } = officeWithTwoRooms();
  const member = session(owner.id, "owner");
  expect((await mintRoute(member, { rooms: [] })).status).toBe(422);
  expect((await mintRoute(member, { rooms: [firstRoomId, firstRoomId] })).status).toBe(422);
  expect((await mintRoute(member, { rooms: ["no-such-room"] })).status).toBe(422);
  const created = await mintRoute(member, { rooms: [firstRoomId] });
  expect(created.status).toBe(201);
  const body = await created.json();
  expect(body.apiToken.rooms).toEqual([firstRoomId]);
  expect(resolveApiToken(body.token)).toMatchObject({ role: "member", rooms: [firstRoomId] });
  // A token without rooms keeps the member's own role and access.
  const full = await (await mintRoute(member, {})).json();
  expect(full.apiToken.rooms).toBeUndefined();
  expect(resolveApiToken(full.token)?.role).toBe("owner");
});

test("a room-limited token reaches only agents and tasks in its rooms, even for an owner", async () => {
  const { owner, firstRoomId, otherRoomId } = officeWithTwoRooms();
  const minted = await mintApiToken({ userId: owner.id, name: "ci", expiresInDays: 30, rooms: [firstRoomId] });
  const auth: AuthResult = { kind: "api", token: resolveApiToken(minted.token)! };
  const call = (handler: typeof handleAgentsRequest, path: string, init: RequestInit = {}) => {
    const req = new Request(`http://local.test${path}`, { ...init, headers: { Authorization: `Bearer ${minted.token}`, "Content-Type": "application/json" } });
    return handler(req, new URL(req.url), auth);
  };

  const listed = await (await call(handleAgentsRequest, "/api/agents"))!.json();
  expect(listed.map((agent: { id: string }) => agent.id)).toEqual(["room-token-in"]);
  expect((await call(handleAgentsRequest, "/api/agents/room-token-out/messages", { method: "POST", body: JSON.stringify({ text: "hi" }) }))!.status).toBe(403);
  agents.get("room-token-in")!.info.state = "thinking";
  expect((await call(handleAgentsRequest, "/api/agents/room-token-in/messages", { method: "POST", body: JSON.stringify({ text: "hi" }) }))!.status).toBe(200);

  tasks.push(
    { id: "aaaa0001", title: "In room", status: "open", roomId: firstRoomId, createdBy: "x", createdAt: 1 },
    { id: "aaaa0002", title: "Other room", status: "open", roomId: otherRoomId, createdBy: "x", createdAt: 1 },
    { id: "aaaa0003", title: "Office-wide", status: "open", createdBy: "x", createdAt: 1 },
  );
  const visible = await (await call(handleTasksRequest, "/api/tasks"))!.json();
  expect(visible.map((task: { title: string }) => task.title).sort()).toEqual(["In room", "Office-wide"]);
  expect((await call(handleTasksRequest, "/api/tasks", { method: "POST", body: JSON.stringify({ title: "Sneak", roomId: otherRoomId }) }))!.status).toBe(404);
});

test("a room-limited token is refused on every route outside agents, tasks and its inbox", async () => {
  const { owner, firstRoomId } = officeWithTwoRooms();
  const limited = await mintApiToken({ userId: owner.id, name: "ci", expiresInDays: 30, rooms: [firstRoomId] });
  const full = await mintApiToken({ userId: owner.id, name: "full", expiresInDays: 30 });
  const server = { requestIP: () => ({ address: "203.0.113.9" }) } as never;
  const authAt = (path: string, token: string) => authenticate(new Request(`http://local.test${path}`, { headers: { Authorization: `Bearer ${token}` } }), server).kind;
  expect(authAt("/api/agents", limited.token)).toBe("api");
  expect(authAt("/api/tasks/abc", limited.token)).toBe("api");
  expect(authAt("/api/me/api-token-inbox/drain", limited.token)).toBe("api");
  for (const path of ["/api/apps", "/api/cronjobs", "/api/pager", "/api/integrations/secrets", "/api/audit", "/api/agentsx", "/backup/status"]) expect(authAt(path, limited.token)).toBe("rejected");
  expect(authAt("/api/apps", full.token)).toBe("api");
  expect(apiTokenRoomLimitedPath("/api/agents/a/logs")).toBe(true);
  expect(apiTokenRoomLimitedPath("/api/api-tokens")).toBe(false);
});

test("a token whose saved room list cannot be read is dropped, not widened", async () => {
  const owner = claimUserByName(USERNAME, { role: "owner", allowedRooms: [] });
  const minted = await mintApiToken({ userId: owner.id, name: "ci", expiresInDays: 30, rooms: [AgentManager.getRooms()[0]!.id] });
  const saved = JSON.parse(readFileSync(API_TOKENS_FILE, "utf8"));
  saved[minted.apiToken.id].rooms = "everything";
  writeFileSync(API_TOKENS_FILE, JSON.stringify(saved));
  _testResetApiTokens();
  expect(resolveApiToken(minted.token)).toBeNull();
});

test("only an agent in one of a limited token's rooms can write to its inbox", async () => {
  const { owner, firstRoomId, otherRoomId } = officeWithTwoRooms();
  const minted = await mintApiToken({ userId: owner.id, name: "ci", expiresInDays: 30, rooms: [firstRoomId] });
  const send = (senderRoomId: string | null) =>
    enqueueApiTokenInboxMessage({ tokenId: minted.apiToken.id, userId: owner.id, text: "hi", senderAgentId: "a", senderAgentName: "A", senderRoomName: "R", senderRoomId });
  expect((await send(otherRoomId)).ok).toBe(false);
  expect((await send(null)).ok).toBe(false);
  expect((await send(firstRoomId)).ok).toBe(true);
});
