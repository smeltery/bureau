import { describe, expect, test } from "bun:test";
import { normalizeDraftUser, pruneDraftsForUser, readDraftsForUser, writeDraftForUser, type DraftStorage } from "./store-drafts.ts";

class MemoryStorage implements DraftStorage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe("draft storage", () => {
  test("normalizes user names for storage keys", () => {
    expect(normalizeDraftUser("  Alice  ")).toBe("alice");
    expect(normalizeDraftUser("   ")).toBeNull();
    expect(normalizeDraftUser(null)).toBeNull();
  });

  test("persists non-empty drafts and removes cleared drafts", () => {
    const storage = new MemoryStorage();
    const liveAgents = new Set(["agent-1"]);

    writeDraftForUser("alice", "agent-1", "finish this thought", storage);
    expect(readDraftsForUser("alice", liveAgents, storage)).toEqual(new Map([["agent-1", "finish this thought"]]));

    writeDraftForUser("alice", "agent-1", "", storage);
    expect(readDraftsForUser("alice", liveAgents, storage)).toEqual(new Map());
  });

  test("keeps drafts isolated by user and live agent", () => {
    const storage = new MemoryStorage();

    writeDraftForUser("alice", "agent-1", "alice text", storage);
    writeDraftForUser("bob", "agent-1", "bob text", storage);
    writeDraftForUser("alice", "removed-agent", "stale text", storage);

    expect(readDraftsForUser("alice", new Set(["agent-1"]), storage)).toEqual(new Map([["agent-1", "alice text"]]));
    expect(readDraftsForUser("bob", new Set(["agent-1"]), storage)).toEqual(new Map([["agent-1", "bob text"]]));
  });

  test("prunes drafts for agents no longer present", () => {
    const storage = new MemoryStorage();

    writeDraftForUser("alice", "agent-1", "keep", storage);
    writeDraftForUser("alice", "agent-2", "remove", storage);
    pruneDraftsForUser("alice", new Set(["agent-1"]), storage);

    expect(readDraftsForUser("alice", new Set(["agent-1", "agent-2"]), storage)).toEqual(new Map([["agent-1", "keep"]]));
  });
});
