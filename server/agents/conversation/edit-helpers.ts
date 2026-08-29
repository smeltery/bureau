import type { LogEntry } from "../../../shared/types.ts";
import { stripAttachmentNotices } from "../../attachment-prompt.ts";
import { listAgentSessions, loadLog, loadSessionsMap } from "../../persistence.ts";
import { stripPluginPrefix } from "../../plugins/run-agent-turn.ts";

export function prefixedUserContent(entry: LogEntry): string {
  const username = entry.metadata?.username as string | undefined;
  return username ? `[${username}] ${entry.content}` : entry.content;
}

export function userMessageOccurrenceIndex(entries: LogEntry[], logEntryId: string, prefixedContent: string): number {
  let occurrenceIndex = 0;
  for (const entry of entries) {
    if (entry.kind !== "user_message") continue;
    if (prefixedUserContent(entry) === prefixedContent) {
      if (entry.id === logEntryId) break;
      occurrenceIndex++;
    }
  }
  return occurrenceIndex;
}

export function findSdkUserMessageIndex(sdkMessages: any[], prefixedContent: string, occurrenceIndex: number): number {
  let matchCount = 0;
  for (let i = 0; i < sdkMessages.length; i++) {
    const message = sdkMessages[i];
    if (message.type !== "user") continue;
    // stripPluginPrefix recovers sdkText from beforeTurn/context envelopes;
    // stripAttachmentNotices recovers it from trailing attachment notice
    // blocks that backends flatten onto user text with no separator.
    if (stripAttachmentNotices(stripPluginPrefix(sdkTextContent(message.message))) === prefixedContent) {
      if (matchCount === occurrenceIndex) return i;
      matchCount++;
    }
  }
  return -1;
}

export function entriesBefore(entries: LogEntry[], logEntryId: string): LogEntry[] {
  const parentEntries: LogEntry[] = [];
  for (const entry of entries) {
    if (entry.id === logEntryId) break;
    parentEntries.push(entry);
  }
  return parentEntries;
}

export function topicMessageCount(entries: LogEntry[]): number {
  return entries.filter((entry) => entry.kind === "user_message" || entry.kind === "text").length;
}

export function findForkSourceSession(agentId: string, oldSessionId: string, logEntryId: string): string {
  let forkFromSessionId = oldSessionId;
  const ownEntries = loadLog(agentId, oldSessionId);
  if (ownEntries.some((entry) => entry.id === logEntryId)) return forkFromSessionId;

  const sessionsMap = loadSessionsMap(agentId);
  let walk: string | undefined = sessionsMap[oldSessionId]?.forkedFrom;
  const visited = new Set<string>([oldSessionId]);
  while (walk && !visited.has(walk)) {
    visited.add(walk);
    const ancestorEntries = loadLog(agentId, walk);
    if (ancestorEntries.some((entry) => entry.id === logEntryId)) {
      forkFromSessionId = walk;
      break;
    }
    walk = sessionsMap[walk]?.forkedFrom;
  }
  return forkFromSessionId;
}

export function findOwnerSessionHint(agentId: string, oldSessionId: string, logEntryId: string): string {
  try {
    for (const session of listAgentSessions(agentId)) {
      if (session.sessionId === oldSessionId) continue;
      if (loadLog(agentId, session.sessionId).some((entry) => entry.id === logEntryId)) {
        const label = session.topic ?? session.sessionId.slice(0, 8) + "...";
        return ` This message lives in a different session ("${label}"). Use /resume to switch to it first, then edit.`;
      }
    }
  } catch {}
  return "";
}

function sdkTextContent(message: any): string {
  const contentBlocks = Array.isArray(message?.content) ? message.content : Array.isArray(message) ? message : typeof message === "string" ? [{ type: "text", text: message }] : [];
  return contentBlocks
    .filter((block: any) => block.type === "text")
    .map((block: any) => block.text)
    .join("");
}
