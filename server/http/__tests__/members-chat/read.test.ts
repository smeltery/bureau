import { afterEach, beforeEach, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthResult } from "../../../auth/auth-middleware.ts";
import type { ServerMessage, UserRecord } from "../../../../shared/types.ts";
import { createMembersChatStore, type MembersChatStore } from "../../../members-chat/store.ts";
import { handleMembersChatRequest } from "../../members-chat.ts";
import { browsers } from "../../../ws/broadcast.ts";
import { bindWsUser, clearWsUser } from "../../../user-sockets.ts";

let dir: string, store: MembersChatStore;
const sockets: ServerWebSocket<unknown>[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bureau-chat-read-http-"));
  store = createMembersChatStore(dir);
});
afterEach(() => {
  for (const ws of sockets.splice(0)) {
    browsers.delete(ws);
    clearWsUser(ws);
  }
  rmSync(dir, { recursive: true, force: true });
});
function auth(userId: string): AuthResult {
  return { kind: "ok", session: { userId, username: userId, role: "member", sessionIdHash: "hash", sessionPrefix: "session", needsRolling: false, absoluteExpiresAt: Date.now() + 10000 } };
}
function connect(userId?: string) {
  const frames: ServerMessage[] = [];
  const ws = {
    send: (data: string) => {
      frames.push(JSON.parse(data));
      return 1;
    },
  } as ServerWebSocket<unknown>;
  if (userId) bindWsUser(ws, { id: userId, name: userId, role: "member" } as UserRecord);
  browsers.add(ws);
  sockets.push(ws);
  return frames;
}
async function request(user: AuthResult | undefined, body: unknown, path = "/api/members-chat/read", method = "POST") {
  const req = new Request("http://office.test" + path, { method, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
  return handleMembersChatRequest(req, new URL(req.url), user, store);
}

test("read receipts reach only the caller's tabs and ignore a claimed user id", async () => {
  const mine = connect("alice"),
    anotherTab = connect("alice"),
    other = connect("bob"),
    unbound = connect();
  const message = store.post({ userId: "bob", userName: "Bob", content: "hello" });
  const response = await request(auth("alice"), { lastReadId: message.id, userId: "bob" });
  expect(response?.status).toBe(200);
  const summary = await response?.json();
  expect(summary).toEqual({ userId: "alice", readPointer: message.id, unread: 0, latestId: message.id });
  expect(mine).toEqual([{ type: "members_chat_summary", summary }]);
  expect(anotherTab).toEqual(mine);
  expect(other).toEqual([]);
  expect(unbound).toEqual([]);
  expect(store.summary("bob").unread).toBe(1);
});

test("posts and deletions refresh each member's count without broadcasting another member's read pointer", async () => {
  const alice = connect("alice"),
    bob = connect("bob");
  const response = await request(auth("bob"), { text: "hello" }, "/api/members-chat");
  const message = await response?.json();
  expect(alice.at(-1)).toEqual({ type: "members_chat_summary", summary: store.summary("alice") });
  expect(bob.at(-1)).toEqual({ type: "members_chat_summary", summary: store.summary("bob") });
  await request(auth("alice"), { lastReadId: message.id });
  const page = await request(auth("alice"), null, "/api/members-chat", "GET");
  expect(await page?.json()).toMatchObject({ summary: store.summary("alice") });
  await request(auth("bob"), null, "/api/members-chat/" + message.id, "DELETE");
  expect(alice.at(-1)).toEqual({ type: "members_chat_summary", summary: { userId: "alice", readPointer: message.id, unread: 0, latestId: null } });
  expect(bob.at(-1)).toEqual({ type: "members_chat_summary", summary: { userId: "bob", readPointer: null, unread: 0, latestId: null } });
});

test("read updates require a browser session and a string message id", async () => {
  for (const user of [undefined, { kind: "loopback" }, { kind: "api", token: { userId: "alice" } }] as Array<AuthResult | undefined>) {
    expect((await request(user, { lastReadId: "anything" }))?.status).toBe(401);
  }
  for (const body of [null, [], {}, { lastReadId: 1 }]) expect((await request(auth("alice"), body))?.status).toBe(400);
  expect(store.summary("alice").readPointer).toBeNull();
});
