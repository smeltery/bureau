import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, test } from "bun:test";
import { createMemoryStore, isSafeScopeId, OVER_CAP_NOTICE, renderCapped, versionOf } from "../memory-store.ts";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "bureau-memory-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("memory store", () => {
  test("appends stamped lines and reads the raw file with a version", () => {
    const store = createMemoryStore({
      stateRoot: tempRoot(),
      today: () => "2026-07-04",
      now: () => "2026-07-04T12:00:00.000Z",
    });

    const appended = store.append({ scope: "office", scopeId: null, author: "Nina", text: "Prefer concise status updates." });
    expect(appended.item.raw).toBe("- Nina, 2026-07-04: Prefer concise status updates.");

    const read = store.read("office", null);
    expect(read.text).toBe("- Nina, 2026-07-04: Prefer concise status updates.\n");
    expect(read.version).toBe(versionOf(read.text));
  });

  test("rejects exact duplicate facts after normalization", () => {
    const store = createMemoryStore({ stateRoot: tempRoot(), today: () => "2026-07-04" });
    store.append({ scope: "agent", scopeId: "agent_1", author: "Nina", text: "Use Bun for package commands." });

    const duplicate = store.findDuplicate("agent", "agent_1", " use bun for package commands! ");
    expect(duplicate?.text).toBe("Use Bun for package commands.");
  });

  test("guards full-file rewrites with optimistic versions", () => {
    const store = createMemoryStore({ stateRoot: tempRoot() });
    const first = store.read("room", "room_1");

    const saved = store.replace({ scope: "room", scopeId: "room_1", author: "Nina", text: "- Nina, 2026-07-04: Keep tests focused.\n", expectedVersion: first.version });
    expect(saved.ok).toBe(true);

    const stale = store.replace({ scope: "room", scopeId: "room_1", author: "Nina", text: "", expectedVersion: first.version });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.version).toBe(versionOf("- Nina, 2026-07-04: Keep tests focused.\n"));
  });

  test("validates scope identifiers used in file paths", () => {
    expect(isSafeScopeId("room_1-agent-2")).toBe(true);
    expect(isSafeScopeId("../secrets")).toBe(false);
    expect(isSafeScopeId("room/1")).toBe(false);
    expect(isSafeScopeId("")).toBe(false);
  });

  test("renders newest prompt lines under the cap", () => {
    expect(renderCapped(["first", "second", "third"], 12)).toBe(`second\nthird\n${OVER_CAP_NOTICE}`);
  });
});
