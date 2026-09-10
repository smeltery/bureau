import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeProjectDir } from "../../agents/session/paths.ts";
import { claudeSessionStore } from "./session-store.ts";

const roots: string[] = [];
const projectKey = "project";

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = join(tmpdir(), `bureau-claude-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  roots.push(root);
  return root;
}

describe("claudeSessionStore", () => {
  test("loads the requested session from the configured Claude root", async () => {
    const root = tempRoot();
    const cwd = join(root, "work");
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const projectDir = claudeProjectDir(cwd, { CLAUDE_CONFIG_DIR: root });
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, `${sessionId}.jsonl`), '{"type":"user","uuid":"u1"}\n{"type":"assistant","uuid":"a1"}\n');

    const entries = await claudeSessionStore(sessionId, cwd, { CLAUDE_CONFIG_DIR: root }).load({ sessionId, projectKey });

    expect(entries?.map((entry) => entry.uuid)).toEqual(["u1", "a1"]);
  });

  test("writes forked sessions without overwriting the parent", async () => {
    const root = tempRoot();
    const cwd = join(root, "work");
    const parentId = "22222222-2222-4222-8222-222222222222";
    const childId = "33333333-3333-4333-8333-333333333333";
    mkdirSync(claudeProjectDir(cwd, { CLAUDE_CONFIG_DIR: root }), { recursive: true });

    const store = claudeSessionStore(parentId, cwd, { CLAUDE_CONFIG_DIR: root });
    await store.append({ sessionId: childId, projectKey }, [{ type: "user", uuid: "child-user" } as any]);

    const childEntries = await claudeSessionStore(childId, cwd, { CLAUDE_CONFIG_DIR: root }).load({ sessionId: childId, projectKey });
    expect(childEntries?.[0]?.uuid).toBe("child-user");
    await expect(store.append({ sessionId: parentId, projectKey }, [{ type: "user" } as any])).rejects.toThrow("Cannot access this Claude conversation.");
  });
});
