import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SummaryState } from "../../agents/summaries/summary.ts";
import { atomicWriteFileSync, LOGS_DIR } from "../paths.ts";
import { loadLog } from "./logs.ts";
import type { SessionsMap } from "./sessions.ts";
import { listTranscripts } from "./transcript-files.ts";

function metadata(agentId: string): SessionsMap {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(LOGS_DIR, agentId, "sessions.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Invalid session metadata");
  for (const value of Object.values(raw)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid session metadata entry");
  }
  return raw as SessionsMap;
}

function transcript(agentId: string, sessionId: string) {
  try {
    return listTranscripts(join(LOGS_DIR, agentId)).find((file) => file.sessionId === sessionId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function readSessionSummary(agentId: string, sessionId: string): SummaryState | null {
  if (!transcript(agentId, sessionId)) return null;
  const entry = metadata(agentId)[sessionId];
  return {
    entries: loadLog(agentId, sessionId),
    summary: typeof entry?.summary === "string" ? entry.summary : undefined,
    throughEntryId: typeof entry?.summaryThroughEntryId === "string" ? entry.summaryThroughEntryId : undefined,
  };
}

/** A late generation may append metadata, but must not revive or overwrite history. */
export function persistSessionSummary(agentId: string, sessionId: string, previous: SummaryState, summary: string, throughEntryId: string): boolean {
  const file = transcript(agentId, sessionId);
  if (!file) return false;
  const map = metadata(agentId);
  const entry = map[sessionId];
  if (entry?.summary !== previous.summary || entry?.summaryThroughEntryId !== previous.throughEntryId) return false;
  const end = previous.entries.findIndex((item) => item.id === throughEntryId);
  if (end < 0) return false;
  const current = loadLog(agentId, sessionId);
  for (let index = 0; index <= end; index++) {
    const before = previous.entries[index];
    const after = current[index];
    if (!after || before.id !== after.id || before.kind !== after.kind || before.content !== after.content) return false;
  }
  map[sessionId] = {
    ...(entry ?? { topic: null, lastModified: file.mtimeMs }),
    summary,
    summaryThroughEntryId: throughEntryId,
    summaryAt: Date.now(),
  };
  // No mkdir: deletion while generation was in flight must stay deleted.
  atomicWriteFileSync(join(LOGS_DIR, agentId, "sessions.json"), JSON.stringify(map, null, 2));
  return true;
}
