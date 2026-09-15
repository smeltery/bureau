import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createMembersChatStore, MembersChatError, MEMBERS_CHAT_MAX_CHARS, monthKey, monthOfId, type MembersChatStore } from "./store.ts";

const AUG = Date.UTC(2026, 7, 15, 12, 0, 0);
const SEP = Date.UTC(2026, 8, 5, 9, 0, 0);

let dir: string;
let clock = AUG;
let store: MembersChatStore;

const nil = { userId: "u-nil", userName: "Nil" };
const pau = { userId: "u-pau", userName: "Pau", device: "Phone" };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bureau-members-chat-"));
  clock = AUG;
  store = createMembersChatStore(dir, { now: () => clock });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function postN(n: number, author = nil): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    ids.push(store.post({ ...author, content: `m${ids.length}` }).id);
    clock += 1000;
  }
  return ids;
}

describe("ids and months", () => {
  it("names the month in UTC and reads it back from the id", () => {
    expect(monthKey(AUG)).toBe("2026-08");
    const m = store.post({ ...nil, content: "hi" });
    expect(m.id).toMatch(/^202608-[0-9a-f]{8}$/);
    expect(monthOfId(m.id)).toBe("2026-08");
    expect(monthOfId("garbage")).toBeNull();
  });

  it("writes one file per month", () => {
    postN(2);
    clock = SEP;
    postN(1);
    expect(readdirSync(dir).sort()).toEqual(["2026-08.jsonl", "2026-09.jsonl"]);
  });
});

describe("post and page", () => {
  it("keeps the author snapshot and device", () => {
    const m = store.post({ ...pau, content: "hello" });
    expect(m).toMatchObject({
      kind: "user",
      userId: "u-pau",
      userName: "Pau",
      device: "Phone",
      content: "hello",
    });
  });

  it("pages newest-first with a before cursor", () => {
    const ids = postN(5);
    const page = store.page({ limit: 2 });
    expect(page.messages.map((m) => m.id)).toEqual([ids[3], ids[4]]);
    expect(page.hasMore).toBe(true);
    const older = store.page({ limit: 2, before: ids[3] });
    expect(older.messages.map((m) => m.id)).toEqual([ids[1], ids[2]]);
  });

  it("pages across a month boundary", () => {
    const aug = postN(2);
    clock = SEP;
    const sep = postN(2);
    const page = store.page({ limit: 3 });
    expect(page.messages.map((m) => m.id)).toEqual([aug[1], sep[0], sep[1]]);
    expect(page.hasMore).toBe(true);
  });

  it("rejects empty and too-long content", () => {
    expect(() => store.post({ ...nil, content: "   " })).toThrow(MembersChatError);
    expect(() => store.post({ ...nil, content: "x".repeat(MEMBERS_CHAT_MAX_CHARS + 1) })).toThrow(MembersChatError);
  });
});

describe("pin and delete", () => {
  it("pins and unpins without rewriting history order", () => {
    const [a, b] = postN(2);
    expect(store.setPinned(a, true)?.pinnedAt).toBeDefined();
    expect(store.page().pinned.map((m) => m.id)).toEqual([a]);
    store.setPinned(a, false);
    expect(store.page().pinned).toEqual([]);
    expect(store.page().messages.map((m) => m.id)).toEqual([a, b]);
  });

  it("deletes by append so the id stays a valid cursor", () => {
    const ids = postN(3);
    store.delete(ids[1]);
    expect(store.get(ids[1])).toBeNull();
    const page = store.page({ limit: 10, before: ids[1] });
    expect(page.messages.map((m) => m.id)).toEqual([ids[0]]);
  });
});
