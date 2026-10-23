import type { StorageCategoryId, StorageUsageWire } from "../../shared/storage-types.ts";
import { STORAGE_CATEGORY_ORDER } from "../../shared/storage-labels.ts";
import { logContent, logMessage, logParts, type LogMessage, type LogParam, type LogMessageKey } from "../../shared/i18n/log-message.ts";

const categoryKeys = {
  transcripts: "logs.report.transcripts",
  attachments: "logs.report.attachments",
  metadata: "logs.report.metadata",
  "codex-home": "logs.report.codexHome",
  cronjobs: "logs.report.cronjobs",
  memory: "logs.report.memory",
  "token-logs": "logs.report.tokenLogs",
  "terminal-recordings": "logs.report.recordings",
  "other-state": "logs.report.otherState",
  backups: "logs.report.backups",
} as const satisfies Record<StorageCategoryId, LogMessageKey>;

function size(bytes: number): LogParam {
  return Number.isFinite(bytes) && bytes >= 0 ? { bytes } : logMessage("logs.report.unknownSize");
}
function escapeCell(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("\n", " ");
}
function row(cells: LogParam[]): LogParam {
  return { parts: ["| ", ...cells.flatMap((cell, index) => (index ? [" | ", cell] : [cell])), " |"] };
}

export function storageReportMessage(usage: StorageUsageWire): LogMessage {
  const categories = new Map(usage.categories.map((category) => [category.id, category]));
  const backupBytes = categories.get("backups")?.bytes ?? 0;
  const totalBytes = usage.stateRootBytes + backupBytes;
  const lines: LogParam[] = [
    logMessage("logs.report.storageTitle"),
    "",
    logMessage("logs.report.storageSummary", { total: size(totalBytes), state: size(usage.stateRootBytes), backups: size(backupBytes) }),
    logMessage("logs.report.measuredAt", { date: { timestamp: usage.measuredAt, style: "full" } }),
    "",
    logMessage("logs.report.storageColumns"),
    "| --- | ---: | ---: |",
  ];
  for (const id of STORAGE_CATEGORY_ORDER) {
    const category = categories.get(id);
    const unavailable = category?.available === false;
    lines.push(row([logMessage(categoryKeys[id]), unavailable ? logMessage("logs.report.unavailable") : size(category?.bytes ?? 0), unavailable ? "-" : { number: category?.files ?? 0 }]));
  }
  lines.push(row([{ parts: ["**", logMessage("logs.report.total"), "**"] }, { parts: ["**", size(totalBytes), "**"] }, ""]));
  const largestAgents = [...usage.agents].sort((a, b) => b.transcriptBytes + b.attachmentBytes - (a.transcriptBytes + a.attachmentBytes)).slice(0, 10);
  if (largestAgents.length > 0) {
    lines.push("", logMessage("logs.report.biggestAgents"), "", logMessage("logs.report.agentStorageColumns"), "| --- | ---: | ---: | --- |");
    for (const agent of largestAgents) {
      lines.push(
        row([
          `\`${escapeCell(agent.agentId)}\``,
          size(agent.transcriptBytes + agent.attachmentBytes),
          { number: agent.sessions },
          agent.lastActivityAt === null ? "-" : { timestamp: agent.lastActivityAt, style: "full" },
        ]),
      );
    }
  }
  lines.push("", logMessage("logs.report.storageReadonly"));
  return logParts(lines.flatMap((line, index) => (index ? ["\n", line] : [line])));
}

export function renderStorageReport(usage: StorageUsageWire): string {
  return logContent(storageReportMessage(usage)).content;
}
