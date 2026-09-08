// Append-only per-token JSONL conversation log under ~/.bureau/token-logs/.

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, truncateSync } from "fs";
import { join } from "path";
import { StringDecoder } from "string_decoder";
import type { ApiTokenLogEntry } from "../../shared/types.ts";
import { API_TOKEN_LOGS_DIR } from "../persistence/paths.ts";

export const API_TOKEN_LOG_PAGE_SIZE = 500;

export function tokenLogPath(id: string): string {
  return join(API_TOKEN_LOGS_DIR, `${id}.jsonl`);
}

export function ensureTokenLogsDir(): void {
  mkdirSync(API_TOKEN_LOGS_DIR, { recursive: true });
}

interface LogHint {
  size: number;
  firstSequence: number;
  tailSequence: number;
  cursorSequence: number;
  cursorOffset: number;
}

const logHints = new Map<string, LogHint>();

export function _testResetApiTokenLogs(): void {
  logHints.clear();
}

function fileSize(id: string): number {
  try {
    return statSync(tokenLogPath(id)).size;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return 0;
    throw err;
  }
}

function parseLogEntry(line: string, previous: number): ApiTokenLogEntry {
  const entry = JSON.parse(line) as ApiTokenLogEntry;
  if (
    !entry ||
    !Number.isSafeInteger(entry.sequence) ||
    entry.sequence <= previous ||
    typeof entry.id !== "string" ||
    typeof entry.text !== "string" ||
    typeof entry.sentAt !== "number" ||
    (entry.direction !== "from_agent" && entry.direction !== "to_agent")
  ) {
    throw new Error("Invalid API token log entry");
  }
  return entry;
}

export function appendTokenLog(id: string, entry: ApiTokenLogEntry): void {
  ensureTokenLogsDir();
  const hint = logHints.get(id);
  const line = JSON.stringify(entry) + "\n";
  try {
    appendFileSync(tokenLogPath(id), line);
  } catch (err) {
    logHints.delete(id);
    throw err;
  }
  logHints.set(id, {
    size: fileSize(id),
    firstSequence: hint?.firstSequence || entry.sequence,
    tailSequence: entry.sequence,
    cursorSequence: hint?.cursorSequence ?? 0,
    cursorOffset: hint?.cursorOffset ?? 0,
  });
}

export function scanTokenLog(id: string, visit?: (entry: ApiTokenLogEntry) => void): LogHint {
  let firstSequence = 0;
  let tailSequence = 0;
  let completeBytes = 0;
  const path = tokenLogPath(id);
  if (existsSync(path)) {
    const fd = openSync(path, "r");
    const buffer = Buffer.alloc(64 * 1024);
    const decoder = new StringDecoder("utf8");
    let pending = "";
    let corrupt = false;
    try {
      let count: number;
      while (!corrupt && (count = readSync(fd, buffer, 0, buffer.length, null)) > 0) {
        pending += decoder.write(buffer.subarray(0, count));
        let newline: number;
        while ((newline = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          completeBytes += Buffer.byteLength(line + "\n");
          if (!line.trim()) continue;
          try {
            const entry = parseLogEntry(line, tailSequence);
            firstSequence ||= entry.sequence;
            tailSequence = entry.sequence;
            visit?.(entry);
          } catch {
            corrupt = true;
            break;
          }
        }
      }
    } finally {
      closeSync(fd);
    }
    if (corrupt) {
      renameSync(path, `${path}.corrupt-${Date.now()}`);
      console.error("[auth] quarantined corrupt API token log:", id);
      firstSequence = 0;
      tailSequence = 0;
    } else if (fileSize(id) > completeBytes) {
      truncateSync(path, completeBytes);
      console.error("[auth] removed incomplete API token log tail:", id);
    }
  }
  const hint: LogHint = {
    size: fileSize(id),
    firstSequence,
    tailSequence,
    cursorSequence: tailSequence,
    cursorOffset: fileSize(id),
  };
  logHints.set(id, hint);
  return hint;
}

export function refreshTokenLog(id: string): LogHint {
  const previous = logHints.get(id);
  if (previous && previous.size === fileSize(id)) return previous;
  return scanTokenLog(id);
}

export function readTokenLogAfter(id: string, after: number, limit = API_TOKEN_LOG_PAGE_SIZE): { entries: ApiTokenLogEntry[]; firstSequence: number; latestHint: LogHint } {
  const hint = refreshTokenLog(id);
  const entries: ApiTokenLogEntry[] = [];
  const firstSequence = hint.firstSequence || hint.tailSequence;
  if (hint.size === 0 || after >= hint.tailSequence) return { entries, firstSequence, latestHint: hint };

  const start = after === hint.cursorSequence ? hint.cursorOffset : 0;
  const raw = readFileSync(tokenLogPath(id));
  let pending = raw.subarray(start).toString("utf8");
  let sequence = start === 0 ? 0 : after;
  let offset = start;
  while (entries.length < limit) {
    const newline = pending.indexOf("\n");
    if (newline < 0) break;
    const line = pending.slice(0, newline);
    pending = pending.slice(newline + 1);
    offset += Buffer.byteLength(line + "\n");
    if (!line.trim()) continue;
    const entry = parseLogEntry(line, sequence);
    sequence = entry.sequence;
    if (sequence > after) entries.push(entry);
    hint.cursorSequence = sequence;
    hint.cursorOffset = offset;
  }
  return { entries, firstSequence, latestHint: hint };
}

export interface LegacyInboxMessage {
  sequence?: number;
  id: string;
  sentAt: number;
  text: string;
  senderAgentId: string;
  senderAgentName: string;
  senderRoomName: string;
}

/** Assign sequences to a legacy inbox and append any missing rows into the JSONL log. */
export function migrateLegacyInbox(id: string, inbox: LegacyInboxMessage[], lastSequence: number): { lastSequence: number; failed: boolean } {
  for (const message of inbox) {
    if (message.sequence !== undefined) lastSequence = Math.max(lastSequence, message.sequence);
  }
  let previous = 0;
  const ordered = inbox.every((message) => {
    const valid = message.sequence !== undefined && message.sequence > previous;
    previous = message.sequence ?? previous;
    return valid;
  });
  if (!ordered) for (const message of inbox) message.sequence = ++lastSequence;
  const pendingIds = new Set(inbox.map((message) => message.id));
  try {
    const hint = scanTokenLog(id, (entry) => {
      pendingIds.delete(entry.id);
    });
    if (hint.tailSequence === 0) for (const message of inbox) pendingIds.add(message.id);
    let logSequence = hint.tailSequence;
    for (const message of inbox) {
      if (!pendingIds.has(message.id)) continue;
      appendTokenLog(id, {
        direction: "from_agent",
        sequence: message.sequence!,
        id: message.id,
        sentAt: message.sentAt,
        text: message.text,
        senderAgentId: message.senderAgentId,
        senderAgentName: message.senderAgentName,
        senderRoomName: message.senderRoomName,
      });
      logSequence = Math.max(logSequence, message.sequence!);
    }
    return { lastSequence: Math.max(lastSequence, logSequence), failed: false };
  } catch (err) {
    console.error("[auth] could not recover API token log:", id, err);
    return { lastSequence, failed: true };
  }
}
