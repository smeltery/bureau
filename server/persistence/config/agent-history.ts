import { readFileSync, existsSync } from "fs";
import { AGENT_HISTORY_FILE, atomicWriteFileSync } from "../paths.ts";
import type { AgentInfo, EffortLevel } from "../../../shared/types.ts";

// Per-agent last-known snapshot. Entries are never removed.
// Consumers: /usage (attribution — killed agents keep contributing to
// lifetime spend forever) and the spawn menu's revive chips (config
// rehydration). `killedAt: null` means currently-alive (or a legacy
// pre-revive entry); the revive-payload fields are optional for backward
// compat with the existing on-disk file.
export interface AgentHistoryEntry {
  name: string;
  userId?: string | null;
  lastRoomId: string;
  lastRoomName: string;
  killedAt?: number | null;
  cwd?: string;
  outfit?: AgentInfo["outfit"];
  permissionMode?: AgentInfo["permissionMode"];
  modelFamily?: string;
  effort?: EffortLevel;
  agentType?: AgentInfo["agentType"];
  codexSandbox?: AgentInfo["codexSandbox"];
  lastSessionId?: string | null;
  topic?: string | null;
  customInstructions?: string | null;
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
    atomicWriteFileSync(AGENT_HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (err) {
    console.error("Failed to save agent history:", err);
  }
}
