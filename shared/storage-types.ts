export type StorageCategoryId = "transcripts" | "attachments" | "metadata" | "codex-home" | "cronjobs" | "other-state" | "backups";

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
