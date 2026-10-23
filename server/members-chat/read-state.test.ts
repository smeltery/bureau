import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMembersChatStore, type MembersChatStore } from "./store.ts";

let dir: string;
let clock: number;
let store: MembersChatStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bureau-chat-reads-"));
  clock = Date.UTC(2026, 8, 20);
  store = createMembersChatStore(dir, { now: () => clock });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const post = () => store.post({ userId: "author", userName: "Author", content: "message" });

test("read positions survive restart and never move backward, including deleted anchors", () => {
  const first = post();
  clock -= 5000;
  const second = post();
  clock = Date.UTC(2026, 9, 1);
  const third = post();
  expect(store.summary("reader")).toEqual({ userId: "reader", readPointer: null, unread: 3, latestId: third.id });
  expect(store.markRead("reader", second.id).unread).toBe(1);
  expect(store.markRead("reader", first.id).readPointer).toBe(second.id);
  store.delete(second.id);
  store = createMembersChatStore(dir);
  expect(store.summary("reader")).toEqual({ userId: "reader", readPointer: second.id, unread: 1, latestId: third.id });
  expect(store.markRead("reader", third.id).unread).toBe(0);
  expect(store.markRead("reader", first.id).unread).toBe(0);
  expect(store.summary("other").unread).toBe(2);
});

test("unknown ids cannot clear unread messages, pins do not add unread, and deletions remove them", () => {
  expect(store.summary("reader").latestId).toBeNull();
  const first = post(),
    second = post();
  expect(store.markRead("reader", "209912-ffffffff").unread).toBe(2);
  expect(store.markRead("reader", "../../reads.json").readPointer).toBeNull();
  store.setPinned(first.id, true);
  expect(store.summary("reader").unread).toBe(2);
  store.delete(second.id);
  expect(store.summary("reader")).toMatchObject({ unread: 1, latestId: first.id });
  store.delete(first.id);
  expect(store.summary("reader")).toMatchObject({ unread: 0, latestId: null });
});

test("read positions remain member-scoped even for object-property names", () => {
  const first = post();
  store.markRead("__proto__", first.id);
  store.markRead("constructor", first.id);
  store = createMembersChatStore(dir);
  expect(store.summary("__proto__").unread).toBe(0);
  expect(store.summary("constructor").unread).toBe(0);
  expect(store.summary("other").unread).toBe(1);
});

test("a failed atomic write leaves both the in-memory and persisted read position unchanged", () => {
  const first = post();
  store.markRead("reader", first.id);
  const second = post();
  mkdirSync(join(dir, "reads.json.tmp"));
  expect(() => store.markRead("reader", second.id)).toThrow();
  expect(store.summary("reader").readPointer).toBe(first.id);
  expect(createMembersChatStore(dir).summary("reader").unread).toBe(1);
});
