import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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

test("replies snapshot server-owned author and excerpt across deletion and restart", async () => {
  const original = store.post({ userId: "bob", userName: "Literal Bob", content: "😀".repeat(220) });
  const response = await request(auth("alice"), { text: "Reply", replyTo: original.id, userId: "bob", userName: "Spoofed" }, "/api/members-chat");
  expect(response?.status).toBe(201);
  const message = await response?.json();
  expect(message.userId).toBe("alice");
  expect(message.replyTo).toEqual({ id: original.id, userName: "Literal Bob", excerpt: "😀".repeat(200) });
  store.delete(original.id);
  store = createMembersChatStore(dir);
  const page = await request(auth("alice"), null, "/api/members-chat", "GET");
  expect((await page!.json()).messages[0].replyTo).toEqual(message.replyTo);
  const missing = await request(auth("alice"), { text: "Another reply", replyTo: original.id }, "/api/members-chat");
  expect(missing?.status).toBe(404);
  expect((await missing!.json()).code).toBe("reply_not_found");
  expect(store.page().messages).toHaveLength(1);
});

test("reply posting rejects non-browser callers and malformed references", async () => {
  const original = store.post({ userId: "bob", userName: "Bob", content: "Hello" });
  for (const user of [undefined, { kind: "loopback" }, { kind: "api", token: { userId: "alice" } }] as Array<AuthResult | undefined>) {
    expect((await request(user, { text: "Reply", replyTo: original.id }, "/api/members-chat"))?.status).toBe(401);
  }
  expect((await request(auth("alice"), { text: "Reply", replyTo: { id: original.id, excerpt: "Spoofed" } }, "/api/members-chat"))?.status).toBe(400);
  expect(store.page().messages).toHaveLength(1);
});
