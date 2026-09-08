import { join } from "path";
import { mkdirSync, appendFileSync, readFileSync, existsSync } from "fs";
import type { LogEntry } from "../../../shared/types.ts";
import { LOGS_DIR } from "../paths.ts";
import { EXTENSION_TO_MIME } from "../files.ts";
import { loadSessionsMap } from "./sessions.ts";
import { prepareLogEntry } from "./log-redaction.ts";

export { prepareLogEntry, redactLogEntry } from "./log-redaction.ts";

export function appendLog(agentId: string, sessionId: string, entry: LogEntry) {
  // Ephemeral entries must never reach disk — defense-in-depth for future callers.
  if (entry.ephemeral) return;
  entry = prepareLogEntry(entry);
  try {
    const agentDir = join(LOGS_DIR, agentId);
    mkdirSync(agentDir, { recursive: true });
    const logFile = join(agentDir, `${sessionId}.jsonl`);
    appendFileSync(logFile, JSON.stringify(entry) + "\n");
  } catch (err) {
    console.error("Failed to write log:", err);
  }
}

// Load log entries from a session's JSONL file
export function loadLog(agentId: string, sessionId: string): LogEntry[] {
  try {
    const logFile = join(LOGS_DIR, agentId, `${sessionId}.jsonl`);
    if (!existsSync(logFile)) return [];
    const content = readFileSync(logFile, "utf-8").trim();
    if (!content) return [];
    return content.split("\n").map((line) => {
      const entry = JSON.parse(line) as LogEntry & { images?: string[] };
      // Migrate legacy images field to attachments
      if (entry.images && !entry.attachments) {
        entry.attachments = entry.images.map((filename) => {
          const ext = filename.split(".").pop() ?? "";
          const mediaType = EXTENSION_TO_MIME[ext] ?? "application/octet-stream";
          return { filename, originalName: filename, mediaType, size: 0 };
        });
        delete entry.images;
      }
      return entry as LogEntry;
    });
  } catch (err) {
    console.error("Failed to load log:", err);
    return [];
  }
}

/**
 * Load log entries for a session, including ancestor entries from forked-from sessions.
 * Walks the forkedFrom chain in sessions.json: for each ancestor, loads entries before
 * forkMessageId (the edited message). Concatenates oldest-ancestor-first, then the
 * fork's own entries. This avoids duplicating log entries across JSONL files.
 */
export function loadLogWithAncestors(agentId: string, sessionId: string): LogEntry[] {
  const sessionsMap = loadSessionsMap(agentId);

  // Build the ancestor chain: [oldest ancestor, ..., immediate parent, self]
  const chain: { sessionId: string; forkMessageId?: string }[] = [];
  let current: string | undefined = sessionId;
  const visited = new Set<string>(); // guard against cycles
  while (current) {
    if (visited.has(current)) break;
    visited.add(current);
    const meta: { forkedFrom?: string; forkMessageId?: string } | undefined = sessionsMap[current];
    chain.unshift({ sessionId: current, forkMessageId: meta?.forkMessageId });
    current = meta?.forkedFrom;
  }

  const result: LogEntry[] = [];
  for (let i = 0; i < chain.length; i++) {
    const entries = loadLog(agentId, chain[i].sessionId);
    if (i < chain.length - 1) {
      // Ancestor: take entries before the fork point (the edited message)
      const cutoffId = chain[i + 1].forkMessageId;
      for (const entry of entries) {
        if (entry.id === cutoffId) break;
        result.push(entry);
      }
    } else {
      // Self (leaf): take all entries
      result.push(...entries);
    }
  }
  return result;
}
