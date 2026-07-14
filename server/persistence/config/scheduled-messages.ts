import { existsSync, readFileSync, renameSync } from "fs";
import type { ScheduledMessageEntry } from "../../../shared/types.ts";
import { atomicWriteFileSync, SCHEDULED_MESSAGES_FILE } from "../paths.ts";

function isScheduledMessageEntry(value: unknown): value is ScheduledMessageEntry {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.senderAgentId === "string" &&
    typeof record.senderName === "string" &&
    typeof record.senderRoomName === "string" &&
    typeof record.receiverAgentId === "string" &&
    typeof record.text === "string" &&
    (record.clientMessageId === undefined || typeof record.clientMessageId === "string") &&
    typeof record.deliverAt === "number" &&
    Number.isFinite(record.deliverAt) &&
    typeof record.createdAt === "number" &&
    Number.isFinite(record.createdAt)
  );
}

export function loadScheduledMessages(): ScheduledMessageEntry[] {
  if (!existsSync(SCHEDULED_MESSAGES_FILE)) return [];
  try {
    const raw = JSON.parse(readFileSync(SCHEDULED_MESSAGES_FILE, "utf-8")) as unknown;
    if (!Array.isArray(raw)) throw new Error("scheduled messages file is not an array");
    return raw.filter((entry) => {
      const ok = isScheduledMessageEntry(entry);
      if (!ok) console.error("[scheduled-messages] dropping invalid entry:", JSON.stringify(entry).slice(0, 200));
      return ok;
    });
  } catch (err) {
    const corruptPath = `${SCHEDULED_MESSAGES_FILE}.corrupt-${Date.now()}`;
    try {
      renameSync(SCHEDULED_MESSAGES_FILE, corruptPath);
      console.error(`[scheduled-messages] quarantined corrupt file at ${corruptPath}:`, err);
    } catch (renameErr) {
      console.error("[scheduled-messages] failed to quarantine corrupt file:", renameErr);
    }
    return [];
  }
}

export function saveScheduledMessages(entries: ScheduledMessageEntry[]) {
  atomicWriteFileSync(SCHEDULED_MESSAGES_FILE, JSON.stringify(entries, null, 2));
}
