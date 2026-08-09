import type { StorageCategoryId, StorageCategoryWire, StorageUsageWire } from "../../shared/storage-types.ts";
import { STORAGE_CATEGORY_LABELS, STORAGE_CATEGORY_ORDER } from "../../shared/storage-labels.ts";
import { formatSize } from "../../shared/format/human.ts";

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
    `**${formatSize(totalBytes)} total:** ${formatSize(usage.stateRootBytes)} office state + ${formatSize(backupBytes)} backups.`,
    `_Measured ${measuredAt}._`,
    "",
    "| Category | Size | Files |",
    "| --- | ---: | ---: |",
  ];

  for (const id of STORAGE_CATEGORY_ORDER) {
    const category = categories.get(id);
    const size = category?.available === false ? "unavailable" : formatSize(category?.bytes ?? 0);
    const files = category?.available === false ? "-" : formatCount(category?.files ?? 0);
    lines.push(`| ${STORAGE_CATEGORY_LABELS[id]} | ${size} | ${files} |`);
  }
  lines.push(`| **Total** | **${formatSize(totalBytes)}** | |`);

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
      lines.push(`| \`${escapeCell(agent.agentId)}\` | ${formatSize(stored)} | ${formatCount(agent.sessions)} | ${escapeCell(lastActivity)} |`);
    }
  }

  lines.push("");
  lines.push("_Read-only report. Nothing is deleted automatically._");
  return lines.join("\n");
}
