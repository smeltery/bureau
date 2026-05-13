import { forkSession, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import type { LogEntry } from "../../../shared/types.ts";
import { listAgentSessions, loadLog, loadSessionsMap, persistSessionFork } from "../../persistence.ts";
import { addLogEntry, agents, beginTurn, emit, logCache, persistAll, updateState } from "../state.ts";
import { SessionSwappedError, createSession, createTurnDeferred, replaceSession } from "../session/runtime.ts";
import { persistCurrentSessionTopic } from "../topic.ts";
import { findUsageAtFork } from "../usage.ts";

export async function editMessage(agentId: string, logEntryId: string, newText: string, username?: string) {
  const managed = agents.get(agentId);
  if (!managed) return;
  if (!managed.sessionId) {
    addLogEntry(agentId, "error", "Cannot edit: no active session.");
    return;
  }
  if (managed.info.state !== "waiting_for_response") {
    addLogEntry(agentId, "error", "Cannot edit while agent is busy.");
    return;
  }

  const oldSessionId = managed.sessionId;
  persistCurrentSessionTopic(agentId, managed);
  const oldLogCache = [...(logCache.get(agentId) ?? [])];
  const oldTopic = managed.info.topic;
  const oldTopicStale = managed.info.topicStale;

  try {
    // --- Phase 1: Fallible SDK operations (no UI/cache mutations yet) ---

    // 1. Find the target LogEntry in the current log cache
    const targetEntry = oldLogCache.find((e) => e.id === logEntryId);
    if (!targetEntry || targetEntry.kind !== "user_message") {
      addLogEntry(agentId, "error", "Cannot edit: message not found.");
      return;
    }

    // 2. Get SDK session messages and match by content + occurrence index
    const sdkMessages = await getSessionMessages(oldSessionId);
    const targetUsername = targetEntry.metadata?.username as string | undefined;
    const prefixedContent = targetUsername ? `[${targetUsername}] ${targetEntry.content}` : targetEntry.content;

    // Count which occurrence of this exact content this is among user_message log entries
    const userLogEntries = oldLogCache.filter((e) => e.kind === "user_message");
    let occurrenceIndex = 0;
    for (const e of userLogEntries) {
      const u = e.metadata?.username as string | undefined;
      const prefixed = u ? `[${u}] ${e.content}` : e.content;
      if (prefixed === prefixedContent) {
        if (e.id === logEntryId) break;
        occurrenceIndex++;
      }
    }

    // Find the matching SDK user message, and track the message just before it.
    // forkSession's upToMessageId is inclusive, so we fork at the predecessor to
    // exclude the original message — the edited text replaces it.
    let matchCount = 0;
    let targetIdx = -1;
    for (let i = 0; i < sdkMessages.length; i++) {
      const m = sdkMessages[i];
      if (m.type !== "user") continue;
      // SDK message format: { role: "user", content: [{ type: "text", text: "..." }, ...] }
      const msg = m.message as any;
      const contentBlocks = Array.isArray(msg?.content) ? msg.content : Array.isArray(msg) ? msg : typeof msg === "string" ? [{ type: "text", text: msg }] : [];
      const msgContent = contentBlocks
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("");
      if (msgContent === prefixedContent) {
        if (matchCount === occurrenceIndex) {
          targetIdx = i;
          break;
        }
        matchCount++;
      }
    }

    if (targetIdx === -1) {
      // Walk the agent's on-disk sessions to find which one owns the entry,
      // so the error tells the user where the message actually lives. The
      // chat can show entries from a session that isn't the current backend
      // session — e.g. ContextMenu "New conversation" or message edits that
      // branched the timeline can leave entries from a prior session in view.
      let ownerHint = "";
      try {
        for (const s of listAgentSessions(agentId)) {
          if (s.sessionId === oldSessionId) continue;
          if (loadLog(agentId, s.sessionId).some((e) => e.id === logEntryId)) {
            const label = s.topic ?? s.sessionId.slice(0, 8) + "...";
            ownerHint = ` This message lives in a different session ("${label}"). Use /resume to switch to it first, then edit.`;
            break;
          }
        }
      } catch {}
      addLogEntry(agentId, "error", `Cannot edit: could not locate message in SDK session.${ownerHint}`);
      return;
    }

    // 3. Fork the session. upToMessageId is inclusive, so we fork at the message
    //    just BEFORE the target to exclude the original text. For the first message,
    //    there's no predecessor — start a fresh session instead (equivalent to new
    //    conversation with different text, but preserving the original as branched).
    let newSessionId: string;
    let isFirstMessage = false;
    if (targetIdx === 0) {
      isFirstMessage = true;
      // No fork needed — we'll create a fresh session below (step 5)
      newSessionId = ""; // placeholder, set after createSession
    } else {
      const predecessorUuid = sdkMessages[targetIdx - 1].uuid;
      const forkResult = await forkSession(oldSessionId, { upToMessageId: predecessorUuid });
      newSessionId = forkResult.sessionId;
    }

    // 4. Persist fork metadata (skip for first-message edits — those are fresh sessions
    //    and will get their sessionId from the system/init event, like newConversation).
    if (!isFirstMessage) {
      // If the edited entry lives in an ancestor's JSONL (not the current session's own),
      // point forkedFrom at that ancestor directly. This collapses the chain so
      // loadLogWithAncestors cuts at the right level.
      let forkFromSessionId = oldSessionId;
      const ownEntries = loadLog(agentId, oldSessionId);
      if (!ownEntries.some((e) => e.id === logEntryId)) {
        const sessMap = loadSessionsMap(agentId);
        let walk: string | undefined = sessMap[oldSessionId]?.forkedFrom;
        const visited = new Set<string>([oldSessionId]);
        while (walk && !visited.has(walk)) {
          visited.add(walk);
          const ancestorEntries = loadLog(agentId, walk);
          if (ancestorEntries.some((e) => e.id === logEntryId)) {
            forkFromSessionId = walk;
            break;
          }
          walk = sessMap[walk]?.forkedFrom;
        }
      }
      // Find the parent's cumulative usage at the exact fork point (not the
      // parent's *current* cumulative, which may include later turns the user
      // continued in the original branch). Walk parent's log to find the fork
      // entry's position, then look up the latest snapshot whose anchor entry
      // sits before that position.
      const parentBase = findUsageAtFork(agentId, forkFromSessionId, logEntryId);
      persistSessionFork(agentId, newSessionId, forkFromSessionId, logEntryId, oldTopic, parentBase);
    }

    // 5. Create new session from fork (or fresh session for first-message edit), then close old
    const newSession = isFirstMessage ? createSession(managed) : createSession(managed, newSessionId);
    await replaceSession(agentId, managed, newSession);
    // For first-message edits, sessionId will be set by the system/init event (like newConversation).
    // For forks, set it now.
    managed.sessionId = isFirstMessage ? null : newSessionId;
    managed.topicGenerating = false;
    managed.topicMessageCount = 0;

    // --- Phase 2: UI/cache mutations (point of no return) ---

    // 6. Build parent entries (everything before the edited message)
    const parentEntries: LogEntry[] = [];
    for (const entry of oldLogCache) {
      if (entry.id === logEntryId) break;
      parentEntries.push(entry);
    }

    // 7. Clear UI and replay parent entries (not persisted — ancestors are loaded
    //    via loadLogWithAncestors on resume, avoiding log duplication on disk)
    logCache.set(agentId, []);
    emit({ type: "clear_logs", agentId } as any);
    if (parentEntries.length > 0) {
      logCache.set(agentId, [...parentEntries]);
      for (const entry of parentEntries) {
        emit({ type: "log_entry", entry });
      }
    }

    // 8. Add system log entry at branch point
    addLogEntry(agentId, "system", `Branched from: ${oldTopic || oldSessionId.slice(0, 8) + "..."}`);

    // 9. Inherit topic (marked stale so it regenerates after first exchange)
    managed.info.topic = oldTopic;
    managed.info.topicStale = true;
    emit({ type: "agent_updated", agentId, changes: { topic: oldTopic, topicStale: true } });

    // 10. Send the edited message
    beginTurn(agentId, { humanInput: true });
    addLogEntry(agentId, "user_message", newText, username ? { username } : undefined);

    const prefixedNew = username ? `[${username}] ${newText}` : newText;
    const turn = createTurnDeferred(managed);
    await managed.session!.send(prefixedNew);
    await turn;

    persistAll();
  } catch (err: any) {
    // User aborted (or another explicit session swap) after the fork was
    // installed — the fork and its partial turn are a legitimate result,
    // not a failure. Skip the rollback.
    if (err instanceof SessionSwappedError) {
      persistAll();
      return;
    }
    console.error(`Agent ${agentId} edit/fork error:`, err.message);

    if (managed.sessionId !== oldSessionId) {
      // We switched to the fork — roll back to old session and restore UI
      try {
        const rollbackSession = createSession(managed, oldSessionId);
        await replaceSession(agentId, managed, rollbackSession);
        managed.sessionId = oldSessionId;
      } catch {
        // Can't restore session — leave in error state
      }

      // Restore the old log cache and UI
      logCache.set(agentId, oldLogCache);
      emit({ type: "clear_logs", agentId } as any);
      for (const entry of oldLogCache) {
        emit({ type: "log_entry", entry });
      }

      // Restore topic
      managed.info.topic = oldTopic;
      managed.info.topicStale = oldTopicStale;
      emit({ type: "agent_updated", agentId, changes: { topic: oldTopic, topicStale: oldTopicStale } });
    }

    addLogEntry(agentId, "error", `Failed to branch conversation: ${err.message}`);
    updateState(agentId, "error");
  }
}
