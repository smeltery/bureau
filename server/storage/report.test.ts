import { describe, expect, test } from "bun:test";
import type { StorageUsageWire } from "../../shared/storage-types.ts";
import { renderStorageReport } from "./report.ts";

describe("storage report rendering", () => {
  test("summarizes categories and biggest agents", () => {
    const usage: StorageUsageWire = {
      measuredAt: Date.UTC(2026, 7, 2, 14, 30),
      stateRoot: "/tmp/bureau",
      stateRootBytes: 2048,
      categories: [
        { id: "transcripts", path: "/tmp/bureau/logs", available: true, bytes: 1024, files: 2 },
        { id: "attachments", path: "/tmp/bureau/logs", available: true, bytes: 512, files: 1 },
        { id: "metadata", path: "/tmp/bureau/logs", available: true, bytes: 128, files: 1 },
        { id: "codex-home", path: "/tmp/bureau/codex-home", available: true, bytes: 256, files: 1 },
        { id: "cronjobs", path: "/tmp/bureau/cronjobs", available: true, bytes: 256, files: 3 },
        { id: "memory", path: "/tmp/bureau/memory", available: true, bytes: 128, files: 1 },
        { id: "other-state", path: "/tmp/bureau", available: true, bytes: 0, files: 1 },
        { id: "backups", path: "/tmp/backups", available: true, bytes: 4096, files: 1 },
      ],
      agents: [
        { agentId: "agent|1", transcriptBytes: 768, attachmentBytes: 512, sessions: 2, lastActivityAt: Date.UTC(2026, 7, 2, 14, 0) },
        { agentId: "agent-2", transcriptBytes: 256, attachmentBytes: 0, sessions: 1, lastActivityAt: null },
      ],
    };

    const report = renderStorageReport(usage);

    expect(report).toContain("## Bureau storage");
    expect(report).toContain("**6 KB total:** 2 KB office state + 4 KB backups.");
    expect(report).toContain("| Transcripts | 1 KB | 2 |");
    expect(report).toContain("| Codex home | 256 B | 1 |");
    expect(report).toContain("| Memory | 128 B | 1 |");
    expect(report).toContain("| Backups | 4 KB | 1 |");
    expect(report).toContain("| `agent\\|1` | 1.3 KB | 2 |");
    expect(report).toContain("_Read-only report. Nothing is deleted automatically._");
  });

  test("marks unavailable categories", () => {
    const report = renderStorageReport({
      measuredAt: 0,
      stateRoot: "/tmp/bureau",
      stateRootBytes: 0,
      categories: [{ id: "backups", path: null, available: false, bytes: 0, files: 0 }],
      agents: [],
    });

    expect(report).toContain("| Backups | unavailable | - |");
  });
});
