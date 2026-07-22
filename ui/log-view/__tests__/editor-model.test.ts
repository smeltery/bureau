import { afterEach, describe, expect, test } from "bun:test";
import { readRecentFiles, rememberRecentFile, writeRecentFiles } from "../editor-model.ts";

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  clear(): void {
    this.values.clear();
  }
}

const storage = new MemoryStorage();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storage,
});

afterEach(() => {
  storage.clear();
});

describe("editor recent files", () => {
  test("deduplicates, moves reopened paths first, and caps the list", () => {
    writeRecentFiles(
      "agent-1",
      Array.from({ length: 12 }, (_, i) => `/repo/file-${i}.ts`),
    );

    expect(rememberRecentFile("agent-1", "/repo/file-6.ts").slice(0, 3)).toEqual(["/repo/file-6.ts", "/repo/file-0.ts", "/repo/file-1.ts"]);
    expect(rememberRecentFile("agent-1", "/repo/new.ts")).toHaveLength(12);
    expect(readRecentFiles("agent-1")[0]).toBe("/repo/new.ts");
    expect(readRecentFiles("agent-1")).not.toContain("/repo/file-11.ts");
  });

  test("ignores malformed storage and keeps agents isolated", () => {
    localStorage.setItem("bureau:editor:recent:agent-1", JSON.stringify(["/a.ts", 42, "/b.ts"]));
    localStorage.setItem("bureau:editor:recent:agent-2", "{");

    expect(readRecentFiles("agent-1")).toEqual(["/a.ts", "/b.ts"]);
    expect(readRecentFiles("agent-2")).toEqual([]);
  });
});
