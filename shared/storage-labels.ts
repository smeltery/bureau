import type { StorageCategoryId } from "./storage-types.ts";

export const STORAGE_CATEGORY_ORDER: readonly StorageCategoryId[] = [
  "transcripts",
  "attachments",
  "metadata",
  "codex-home",
  "cronjobs",
  "memory",
  "token-logs",
  "terminal-recordings",
  "other-state",
  "backups",
];

export const STORAGE_CATEGORY_LABELS: Record<StorageCategoryId, string> = {
  transcripts: "Transcripts",
  attachments: "Attachments",
  metadata: "Log metadata",
  "codex-home": "Codex home",
  cronjobs: "Cron jobs",
  memory: "Memory",
  "other-state": "Other office state",
  backups: "Backups",
  "token-logs": "API token conversations",
  "terminal-recordings": "Terminal recordings",
};
