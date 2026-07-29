import { forkSession, getSessionMessages } from "@anthropic-ai/claude-agent-sdk";
import { persistSessionFork } from "../../persistence.ts";
import { addLogEntry, agents, emit, logCache, persistAll, updateState } from "../state.ts";
import { SessionSwappedError, createSession, replaceSession } from "../session/runtime.ts";
import { runAgentTurn } from "../../plugins/run-agent-turn.ts";
import { persistCurrentSessionTopic } from "../topic.ts";
import { findUsageAtFork } from "../usage.ts";
import { entriesBefore, findForkSourceSession, findOwnerSessionHint, findSdkUserMessageIndex, prefixedUserContent, topicMessageCount, userMessageOccurrenceIndex } from "./edit-helpers.ts";

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
    const prefixedContent = prefixedUserContent(targetEntry);
    const occurrenceIndex = userMessageOccurrenceIndex(oldLogCache, logEntryId, prefixedContent);

    // Find the matching SDK user message, and track the message just before it.
    // forkSession's upToMessageId is inclusive, so we fork at the predecessor to
    // exclude the original message — the edited text replaces it.
    const targetIdx = findSdkUserMessageIndex(sdkMessages, prefixedContent, occurrenceIndex);

    if (targetIdx === -1) {
      // Walk the agent's on-disk sessions to find which one owns the entry,
      // so the error tells the user where the message actually lives. The
      // chat can show entries from a session that isn't the current backend
      // session — e.g. ContextMenu "New conversation" or message edits that
      // branched the timeline can leave entries from a prior session in view.
      const ownerHint = findOwnerSessionHint(agentId, oldSessionId, logEntryId);
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
      const forkFromSessionId = findForkSourceSession(agentId, oldSessionId, logEntryId);
      // Find the parent's cumulative usage at the exact fork point (not the
      // parent's *current* cumulative, which may include later turns the user
      // continued in the original branch). Walk parent's log to find the fork
      // entry's position, then look up the latest snapshot whose anchor entry
      // sits before that position.
      const parentBase = findUsageAtFork(agentId, forkFromSessionId, logEntryId);
      // Count the parent's user/text entries up to the fork point — that's
      // the baseline for measuring drift on the new branch. Persisting it
      // alongside the inherited topic lets a later /resume of this fork
      // correctly recognize that the topic is in sync (or not).
      const parentTopicMessageCount = topicMessageCount(entriesBefore(oldLogCache, logEntryId));
      // Fork inherits the active session's cwd (cwd is per-session), so the new
      // branch keeps working in the same directory.
      persistSessionFork(agentId, newSessionId, forkFromSessionId, logEntryId, oldTopic, parentTopicMessageCount, managed.info.cwd, parentBase);
    }

    // 5. Create new session from fork (or fresh session for first-message edit), then close old
    const newSession = isFirstMessage ? createSession(managed) : createSession(managed, newSessionId);
    await replaceSession(agentId, managed, newSession);
    // For first-message edits, sessionId will be set by the system/init event (like newConversation).
    // For forks, set it now.
    managed.sessionId = isFirstMessage ? null : newSessionId;
    managed.topicGenerating = false;

    // --- Phase 2: UI/cache mutations (point of no return) ---

    // 6. Build parent entries (everything before the edited message)
    const parentEntries = entriesBefore(oldLogCache, logEntryId);
    // Anchor drift detection to the parent's text count at the fork point.
    // Zeroing here would trip the regen threshold on the very first new
    // exchange in the fork — defeating the threshold's debounce. Match what's
    // persisted alongside the inherited topic above.
    managed.topicMessageCount = topicMessageCount(parentEntries);

    // 7. Clear UI and replay parent entries (not persisted — ancestors are loaded
    //    via loadLogWithAncestors on resume, avoiding log duplication on disk)
    logCache.set(agentId, []);
    emit({ type: "clear_logs", agentId });
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

    // 10. Send the edited message. The user_message log entry lands before
    // runAgentTurn so it's part of the visible timeline; runAgentTurn's
    // newLogEntries snapshot is taken AFTER, so the user_message is
    // excluded from the slice plugins observe.
    addLogEntry(agentId, "user_message", newText, username ? { username } : undefined);

    const prefixedNew = username ? `[${username}] ${newText}` : newText;
    await runAgentTurn({
      managed,
      visibleText: newText,
      // Raw replacement text is what the user actually wants the model to
      // see; sender prefix is bureau routing applied below.
      originalText: newText,
      sdkText: prefixedNew,
      username: username ?? null,
      origin: "edit-fork",
      humanInput: true,
    });

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
      emit({ type: "clear_logs", agentId });
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
