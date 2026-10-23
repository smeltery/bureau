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

test("authors edit in place while preserving pins, quoted snapshots, read counts and restart history", async () => {
  const original = store.post({ userId: "alice", userName: "Alice", content: "Original" });
  const reply = store.post({ userId: "bob", userName: "Bob", content: "Reply", replyTo: original.id });
  store.setPinned(original.id, true);
  store.markRead("reader", reply.id);
  const before = store.summary("reader");
  const response = await request(auth("alice"), { text: "Updated", userId: "bob" }, "/api/members-chat/" + original.id, "PUT");
  expect(response?.status).toBe(200);
  const edited = await response!.json();
  expect(edited).toMatchObject({ id: original.id, userId: "alice", content: "Updated", timestamp: original.timestamp });
  expect(edited.editedAt).toBeNumber();
  expect(edited.pinnedAt).toBeNumber();
  expect(store.summary("reader")).toEqual(before);
  store = createMembersChatStore(dir);
  expect(store.get(original.id)).toEqual(edited);
  expect(store.page().pinned[0]?.content).toBe("Updated");
  expect(store.get(reply.id)?.replyTo?.excerpt).toBe("Original");
  const later = store.edit(original.id, "Latest");
  expect(later!.editedAt!).toBeGreaterThan(edited.editedAt);
});

test("editing requires the author browser identity and validates text before appending", async () => {
  const original = store.post({ userId: "alice", userName: "Alice", content: "Original" });
  const path = "/api/members-chat/" + original.id;
  const owner = auth("owner");
  if (owner.kind === "ok") owner.session.role = "owner";
  for (const user of [auth("bob"), owner]) expect((await request(user, { text: "Bad", userId: "alice" }, path, "PUT"))?.status).toBe(403);
  for (const user of [undefined, { kind: "loopback" }, { kind: "api", token: { userId: "alice" } }] as Array<AuthResult | undefined>)
    expect((await request(user, { text: "Bad" }, path, "PUT"))?.status).toBe(401);
  for (const body of [null, {}, { text: 42 }, { text: "   " }, { text: "x".repeat(4001) }]) expect((await request(auth("alice"), body, path, "PUT"))?.status).toBe(400);
  expect(store.get(original.id)?.content).toBe("Original");
  store.delete(original.id);
  expect((await request(auth("alice"), { text: "Gone" }, path, "PUT"))?.status).toBe(404);
  expect(store.edit(original.id, "Gone")).toBeNull();
});
