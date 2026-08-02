import type { StorageCategoryId, StorageCategoryWire, StorageUsageWire } from "../../shared/storage-types.ts";

const CATEGORY_LABELS: Record<StorageCategoryId, string> = {
  transcripts: "Transcripts",
  attachments: "Attachments",
  metadata: "Log metadata",
  "codex-home": "Codex home",
  cronjobs: "Cron jobs",
  "other-state": "Other office state",
  backups: "Backups",
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const precision = unit === 0 || value >= 10 || Number.isInteger(value) ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unit]}`;
}

function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

function escapeCell(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function categoryById(categories: StorageCategoryWire[]): Map<StorageCategoryId, StorageCategoryWire> {
  return new Map(categories.map((category) => [category.id, category]));
}

export function renderStorageReport(usage: StorageUsageWire): string {
  const categories = categoryById(usage.categories);
  const backups = categories.get("backups");
  const backupBytes = backups?.bytes ?? 0;
  const totalBytes = usage.stateRootBytes + backupBytes;
  const measuredAt = new Date(usage.measuredAt).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const lines: string[] = [
    "## Bureau storage",
    "",
    `**${formatBytes(totalBytes)} total:** ${formatBytes(usage.stateRootBytes)} office state + ${formatBytes(backupBytes)} backups.`,
    `_Measured ${measuredAt}._`,
    "",
    "| Category | Size | Files |",
    "| --- | ---: | ---: |",
  ];

  for (const id of Object.keys(CATEGORY_LABELS) as StorageCategoryId[]) {
    const category = categories.get(id);
    const size = category?.available === false ? "unavailable" : formatBytes(category?.bytes ?? 0);
    const files = category?.available === false ? "-" : formatCount(category?.files ?? 0);
    lines.push(`| ${CATEGORY_LABELS[id]} | ${size} | ${files} |`);
  }
  lines.push(`| **Total** | **${formatBytes(totalBytes)}** | |`);

  const largestAgents = [...usage.agents].sort((a, b) => b.transcriptBytes + b.attachmentBytes - (a.transcriptBytes + a.attachmentBytes)).slice(0, 10);
  if (largestAgents.length > 0) {
    lines.push("");
    lines.push("### Biggest agents");
    lines.push("");
    lines.push("| Agent | Stored | Sessions | Last activity |");
    lines.push("| --- | ---: | ---: | --- |");
    for (const agent of largestAgents) {
      const stored = agent.transcriptBytes + agent.attachmentBytes;
      const lastActivity = agent.lastActivityAt === null ? "-" : new Date(agent.lastActivityAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
      lines.push(`| \`${escapeCell(agent.agentId)}\` | ${formatBytes(stored)} | ${formatCount(agent.sessions)} | ${escapeCell(lastActivity)} |`);
    }
  }

  lines.push("");
  lines.push("_Read-only report. Nothing is deleted automatically._");
  return lines.join("\n");
}
