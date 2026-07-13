import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { PLUGINS_LOG_FILE } from "../persistence/paths.ts";

// Hook failures and load errors are cross-agent and sometimes pre-agent
// (boot discovery). A dedicated stream keeps them out of chat-log entries
// while still being grep-able for forensics.
export interface PluginFailureRecord {
  pluginId: string;
  hook: "discovery" | "load" | "beforeTurn" | "afterTurn";
  agentId?: string;
  roomId?: string;
  origin?: "user" | "queued" | "skill" | "edit-fork";
  durationMs: number;
  error: unknown;
}

export function logPluginFailure(rec: PluginFailureRecord): void {
  const errorSummary = rec.error instanceof Error ? `${rec.error.name}: ${rec.error.message}` : typeof rec.error === "string" ? rec.error : safeStringify(rec.error);
  const line = JSON.stringify({
    ts: Date.now(),
    pluginId: rec.pluginId,
    hook: rec.hook,
    agentId: rec.agentId,
    roomId: rec.roomId,
    origin: rec.origin,
    durationMs: rec.durationMs,
    error: errorSummary,
  });
  try {
    mkdirSync(dirname(PLUGINS_LOG_FILE), { recursive: true });
    appendFileSync(PLUGINS_LOG_FILE, line + "\n");
  } catch (err) {
    // Fallback to stderr so operators know failures are not being persisted.
    console.error("[plugins] failed to write failure log:", err, "record was:", line);
  }
  console.error(`[plugins] failure: ${line}`);
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
