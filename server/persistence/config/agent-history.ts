import { readFileSync, writeFileSync, existsSync } from "fs";
import { AGENT_HISTORY_FILE } from "../paths.ts";

// Agent history: per-agent last-known name + last-known room (id + name).
// Used by /usage to attribute killed agents to the room they were in, and to
// label the room as "(deleted)" if it no longer exists. Entries are never
// removed — killed agents keep contributing to lifetime spend forever.
export interface AgentHistoryEntry {
  name: string;
  lastRoomId: string;
  lastRoomName: string;
}
export type AgentHistory = Record<string, AgentHistoryEntry>;

export function loadAgentHistory(): AgentHistory {
  try {
    if (!existsSync(AGENT_HISTORY_FILE)) return {};
    return JSON.parse(readFileSync(AGENT_HISTORY_FILE, "utf-8")) as AgentHistory;
  } catch {
    return {};
  }
}

export function saveAgentHistory(history: AgentHistory) {
  try {
    writeFileSync(AGENT_HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (err) {
    console.error("Failed to save agent history:", err);
  }
}
