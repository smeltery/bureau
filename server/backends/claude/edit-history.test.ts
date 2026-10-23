import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { claudeBackend } from "../claude.ts";
import { claudeProjectDir } from "../../agents/session/paths.ts";

test("Claude edits exclude the target and keep the parent and account store intact", async () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-edit-history-"));
  const cwd = join(root, "work");
  const id = "11111111-1111-4111-8111-111111111111";
  const access = { cwd, env: { CLAUDE_CONFIG_DIR: root } };
  const directory = claudeProjectDir(cwd, access.env);
  mkdirSync(directory, { recursive: true });
  const messages = [
    { type: "user", uuid: "u1", message: { role: "user", content: "first" } },
    { type: "assistant", uuid: "a1", message: { role: "assistant", content: [{ type: "text", text: "reply" }] } },
    { type: "user", uuid: "u2", message: { role: "user", content: "replace me" } },
    { type: "assistant", uuid: "a2", message: { role: "assistant", content: [{ type: "text", text: "old reply" }] } },
  ].map((m, i, all) => ({ ...m, parentUuid: i ? all[i - 1]!.uuid : null, sessionId: id, timestamp: new Date().toISOString(), cwd, version: "2.1.0", isSidechain: false }));
  const original = messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
  const file = join(directory, id + ".jsonl");
  writeFileSync(file, original);
  try {
    const middle = await claudeBackend.forkSessionBeforeMessage(id, "u2", access);
    expect(middle.kind).toBe("fork");
    if (middle.kind !== "fork") throw new Error("Expected a linked branch");
    expect((await claudeBackend.getSessionMessages(middle.sessionId, cwd, access)).map((m) => m.text)).toEqual(["first", "reply"]);
    expect(readFileSync(file, "utf8")).toBe(original);
    expect(await claudeBackend.forkSessionBeforeMessage(id, "u1", access)).toEqual({ kind: "fresh" });
    const full = await claudeBackend.forkSessionBeforeMessage(id, null, access);
    if (full.kind !== "fork") throw new Error("Expected a full-history branch");
    expect((await claudeBackend.getSessionMessages(full.sessionId, cwd, access)).map((m) => m.text)).toEqual(["first", "reply", "replace me", "old reply"]);
    await expect(claudeBackend.forkSessionBeforeMessage(id, "missing", access)).rejects.toThrow("not found");
    await expect(claudeBackend.forkSessionBeforeMessage(id, "u2", { cwd, env: { CLAUDE_CONFIG_DIR: join(root, "other") } })).rejects.toThrow();
    expect(readFileSync(file, "utf8")).toBe(original);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
