import { lstatSync, readdirSync } from "fs";
import { join } from "path";
import type { AgentStorageWire, StorageCategoryId, StorageCategoryWire, StorageUsageWire } from "../shared/storage-types.ts";

interface DirUsage {
  bytes: number;
  files: number;
}

export interface StorageRoots {
  stateRoot: string;
  backupDir: string | null;
}

const ZERO: DirUsage = { bytes: 0, files: 0 };

function isReadableDir(path: string): boolean {
  try {
    readdirSync(path);
    return true;
  } catch {
    return false;
  }
}

export function measureTree(path: string): DirUsage {
  let bytes = 0;
  let files = 0;
  const stack = [path];

  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      try {
        bytes += lstatSync(full).size;
        files++;
      } catch {
        // The office may be writing logs while we measure. A vanished file
        // should not make the whole report unavailable.
      }
    }
  }

  return { bytes, files };
}

interface LogsBreakdown {
  transcripts: DirUsage;
  attachments: DirUsage;
  metadata: DirUsage;
  agents: AgentStorageWire[];
}

function measureLogs(logsDir: string): LogsBreakdown {
  const transcripts: DirUsage = { bytes: 0, files: 0 };
  const attachments: DirUsage = { bytes: 0, files: 0 };
  const metadata: DirUsage = { bytes: 0, files: 0 };
  const agents: AgentStorageWire[] = [];

  let agentDirs: string[];
  try {
    agentDirs = readdirSync(logsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return { transcripts, attachments, metadata, agents };
  }

  for (const agentId of agentDirs) {
    const agentDir = join(logsDir, agentId);
    let transcriptBytes = 0;
    let attachmentBytes = 0;
    let sessions = 0;
    let lastActivityAt: number | null = null;

    let entries;
    try {
      entries = readdirSync(agentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = join(agentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "files" && entry.name !== "images") continue;
        const usage = measureTree(full);
        attachmentBytes += usage.bytes;
        attachments.bytes += usage.bytes;
        attachments.files += usage.files;
        continue;
      }

      let stat;
      try {
        stat = lstatSync(full);
      } catch {
        continue;
      }

      if (entry.name.endsWith(".jsonl")) {
        transcriptBytes += stat.size;
        sessions++;
        transcripts.bytes += stat.size;
        transcripts.files++;
        lastActivityAt = Math.max(lastActivityAt ?? 0, stat.mtimeMs);
      } else {
        metadata.bytes += stat.size;
        metadata.files++;
      }
    }

    agents.push({ agentId, transcriptBytes, attachmentBytes, sessions, lastActivityAt });
  }

  agents.sort((a, b) => b.transcriptBytes + b.attachmentBytes - (a.transcriptBytes + a.attachmentBytes));
  return { transcripts, attachments, metadata, agents };
}

function category(id: StorageCategoryId, path: string | null, usage: DirUsage): StorageCategoryWire {
  if (path === null) return { id, path: null, available: false, bytes: 0, files: 0 };
  return { id, path, available: isReadableDir(path), ...usage };
}

export function measureStorage(roots: StorageRoots, now: () => number = Date.now): StorageUsageWire {
  const stateRoot = roots.stateRoot;
  const logsDir = join(stateRoot, "logs");
  const codexHomeDir = join(stateRoot, "codex-home");
  const cronjobsDir = join(stateRoot, "cronjobs");
  const memoryDir = join(stateRoot, "memory");
  const total = measureTree(stateRoot);
  const logs = measureLogs(logsDir);
  const codexHome = measureTree(codexHomeDir);
  const cronjobs = measureTree(cronjobsDir);
  const memory = measureTree(memoryDir);
  const backups = roots.backupDir ? measureTree(roots.backupDir) : ZERO;

  const claimedBytes = logs.transcripts.bytes + logs.attachments.bytes + logs.metadata.bytes + codexHome.bytes + cronjobs.bytes + memory.bytes;
  const claimedFiles = logs.transcripts.files + logs.attachments.files + logs.metadata.files + codexHome.files + cronjobs.files + memory.files;
  const other: DirUsage = {
    bytes: Math.max(0, total.bytes - claimedBytes),
    files: Math.max(0, total.files - claimedFiles),
  };

  return {
    measuredAt: now(),
    stateRoot,
    stateRootBytes: total.bytes,
    categories: [
      category("transcripts", logsDir, logs.transcripts),
      category("attachments", logsDir, logs.attachments),
      category("metadata", logsDir, logs.metadata),
      category("codex-home", codexHomeDir, codexHome),
      category("cronjobs", cronjobsDir, cronjobs),
      category("memory", memoryDir, memory),
      category("other-state", stateRoot, other),
      category("backups", roots.backupDir, backups),
    ],
    agents: logs.agents,
  };
}
