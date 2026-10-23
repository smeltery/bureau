export type StorageCategoryId = "transcripts" | "attachments" | "metadata" | "codex-home" | "cronjobs" | "memory" | "other-state" | "backups";

export interface StorageCategoryWire {
  id: StorageCategoryId;
  path: string | null;
  available: boolean;
  bytes: number;
  files: number;
}

export interface AgentStorageWire {
  agentId: string;
  transcriptBytes: number;
  attachmentBytes: number;
  sessions: number;
  lastActivityAt: number | null;
}

export interface StorageUsageWire {
  measuredAt: number;
  stateRoot: string;
  stateRootBytes: number;
  categories: StorageCategoryWire[];
  agents: AgentStorageWire[];
}

export type PruneTarget = "transcripts" | "attachments";

export type PruneSkipReason = "active-session" | "keep-newest" | "fork-ancestor" | "referenced" | "too-recent";

export interface PrunePolicy {
  target: PruneTarget;
  olderThanDays: number;
  keepPerAgent?: number;
  apply?: boolean;
}

export interface PruneCandidateWire {
  path: string;
  bytes: number;
  agentId: string;
  sessionId?: string;
  ageDays: number;
  mtimeMs: number;
}

export interface PruneSkipWire {
  reason: PruneSkipReason;
  count: number;
  bytes: number;
}

export interface PrunePlanWire {
  target: PruneTarget;
  policy: {
    olderThanDays: number;
    keepPerAgent: number;
  };
  candidates: PruneCandidateWire[];
  bytes: number;
  skipped: PruneSkipWire[];
}

export interface PruneApplyWire {
  deleted: number;
  bytes: number;
  refused: { path: string; reason: string }[];
  aborted?: string;
}

export interface StoragePruneWire {
  plan: PrunePlanWire;
  applied: PruneApplyWire | null;
}

export interface BackupSettings {
  intervalHours: number;
  retention: number;
  dir: string | null;
}

export interface BackupSettingsView {
  settings: BackupSettings;
  effectiveDir: string;
  directoryFromEnvironment: boolean;
}

export interface BackupSettingsSaved extends BackupSettingsView {
  previousDir: string | null;
}

export interface CompressionPlan {
  olderThanDays: number;
  candidates: { path: string; agentId: string; sessionId: string; bytes: number; mtimeMs: number }[];
  bytes: number;
  skipped: { reason: "active-session" | "too-recent"; count: number; bytes: number }[];
}

export interface CompressionResult {
  compressed: number;
  bytesBefore: number;
  bytesAfter: number;
  refused: { path: string; reason: string }[];
}

export interface StorageCompressionWire {
  plan: CompressionPlan;
  applied: CompressionResult | null;
}
