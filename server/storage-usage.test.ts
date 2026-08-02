import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { describe, expect, test } from "bun:test";
import { measureStorage, measureTree } from "./storage-usage.ts";

describe("storage usage measurement", () => {
  test("measures transcripts, attachments, metadata, cronjobs, backups, and other state", () => {
    const root = mkdtempSync(join(tmpdir(), "bureau-storage-"));
    const backup = mkdtempSync(join(tmpdir(), "bureau-backups-"));
    mkdirSync(join(root, "logs", "agent-1", "files"), { recursive: true });
    mkdirSync(join(root, "cronjobs", "job-1", "run-1"), { recursive: true });

    writeFileSync(join(root, "logs", "agent-1", "session-1.jsonl"), "hello");
    writeFileSync(join(root, "logs", "agent-1", "sessions.json"), "{}");
    writeFileSync(join(root, "logs", "agent-1", "files", "image.png"), "1234567");
    writeFileSync(join(root, "cronjobs", "job-1", "run-1", "run.jsonl"), "cron");
    writeFileSync(join(root, "agents.json"), "[]");
    writeFileSync(join(backup, "bureau-2026-08-01.tar.gz"), "backup");

    const usage = measureStorage({ stateRoot: root, backupDir: backup }, () => 42);
    const byId = new Map(usage.categories.map((category) => [category.id, category]));

    expect(usage.measuredAt).toBe(42);
    expect(usage.stateRoot).toBe(root);
    expect(byId.get("transcripts")?.bytes).toBe(5);
    expect(byId.get("attachments")?.bytes).toBe(7);
    expect(byId.get("metadata")?.bytes).toBe(2);
    expect(byId.get("cronjobs")?.bytes).toBe(4);
    expect(byId.get("backups")?.bytes).toBe(6);
    expect(byId.get("other-state")?.bytes).toBe(2);
    expect(usage.agents).toEqual([
      expect.objectContaining({
        agentId: "agent-1",
        transcriptBytes: 5,
        attachmentBytes: 7,
        sessions: 1,
      }),
    ]);
  });

  test("skips unreadable or missing trees instead of throwing", () => {
    const root = mkdtempSync(join(tmpdir(), "bureau-storage-missing-"));

    expect(measureTree(join(root, "missing"))).toEqual({ bytes: 0, files: 0 });
  });
});
