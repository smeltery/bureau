import type { ServerWebSocket } from "bun";
import { browsers } from "../../../ws/broadcast.ts";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthResult } from "../../../auth/auth-middleware.ts";
import { createMembersChatStore, type MembersChatStore } from "../../../members-chat/store.ts";
import { handleMembersChatRequest } from "../../members-chat.ts";

let dir: string, store: MembersChatStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bureau-chat-read-http-"));
  store = createMembersChatStore(dir);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});
function auth(userId: string): AuthResult {
  return { kind: "ok", session: { userId, username: userId, role: "member", sessionIdHash: "hash", sessionPrefix: "session", needsRolling: false, absoluteExpiresAt: Date.now() + 10000 } };
}
async function request(user: AuthResult | undefined, body: unknown, path = "/api/members-chat/read", method = "POST") {
  const req = new Request("http://office.test" + path, { method, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) });
  return handleMembersChatRequest(req, new URL(req.url), user, store);
}

test("reaction updates use the browser identity, broadcast updates only and never change unread", async () => {
  const original = store.post({ userId: "author", userName: "Author", content: "Hello" });
  const path = "/api/members-chat/" + original.id + "/thumbs-up";
  const before = store.summary("reader");
  const frames: unknown[] = [];
  const ws = {
    send: (data: string) => {
      frames.push(JSON.parse(data));
      return 1;
    },
  } as ServerWebSocket<unknown>;
  browsers.add(ws);
  try {
    const response = await request(auth("alice"), { active: true, userId: "bob", userName: "Spoofed" }, path, "PUT");
    expect(response?.status).toBe(200);
    const message = await response!.json();
    expect(message.thumbsUp).toEqual([{ userId: "alice", userName: "alice" }]);
    expect(frames).toEqual([{ type: "members_chat_message", message, updateOnly: true }]);
    expect(store.summary("reader")).toEqual(before);
    await request(auth("bob"), { active: true }, path, "PUT");
    await request(auth("alice"), { active: false, userId: "bob" }, path, "PUT");
    expect(store.get(original.id)?.thumbsUp).toEqual([{ userId: "bob", userName: "bob" }]);
  } finally {
    browsers.delete(ws);
  }
});

test("reactions persist in the original month, remain idempotent and survive editing and pinning", () => {
  let clock = Date.UTC(2026, 0, 1);
  store = createMembersChatStore(dir, { now: () => clock });
  const message = store.post({ userId: "author", userName: "Author", content: "Hello" });
  clock = Date.UTC(2026, 2, 1);
  const reactor = { userId: "__proto__", userName: "Literal name" };
  store.setThumbsUp(message.id, reactor, true);
  const file = join(dir, "2026-01.jsonl");
  const lines = readFileSync(file, "utf8");
  store.setThumbsUp(message.id, reactor, true);
  expect(readFileSync(file, "utf8")).toBe(lines);
  store.setPinned(message.id, true);
  store.edit(message.id, "Updated");
  expect(store.page().pinned[0]?.thumbsUp).toEqual([reactor]);
  store = createMembersChatStore(dir);
  expect(store.get(message.id)?.thumbsUp).toEqual([reactor]);
  store.setThumbsUp(message.id, reactor, false);
  const removed = readFileSync(file, "utf8");
  store.setThumbsUp(message.id, reactor, false);
  expect(readFileSync(file, "utf8")).toBe(removed);
  expect(store.get(message.id)?.thumbsUp).toEqual([]);
  store.delete(message.id);
  expect(store.setThumbsUp(message.id, reactor, true)).toBeNull();
});

test("reaction requests reject non-browser callers and non-boolean state", async () => {
  const message = store.post({ userId: "author", userName: "Author", content: "Hello" });
  const path = "/api/members-chat/" + message.id + "/thumbs-up";
  for (const user of [undefined, { kind: "loopback" }, { kind: "api", token: { userId: "alice" } }] as Array<AuthResult | undefined>)
    expect((await request(user, { active: true }, path, "PUT"))?.status).toBe(401);
  for (const body of [null, {}, [], { active: "false" }, { active: 1 }]) expect((await request(auth("alice"), body, path, "PUT"))?.status).toBe(400);
  expect(store.get(message.id)?.thumbsUp).toBeUndefined();
  store.delete(message.id);
  expect((await request(auth("alice"), { active: true }, path, "PUT"))?.status).toBe(404);
});
