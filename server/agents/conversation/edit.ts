import { pinProviderEnvironment } from "../session/provider-environment.ts";
import { openCodeEnvironmentId } from "../../backends/opencode/profiles/identity.ts";
import { ProviderSignInRequiredError } from "../../internal-types.ts";
import { emitLoginInstructions } from "../session/diagnostics.ts";
import { getBackend } from "../../backends/index.ts";
import { getSessionClaudeConfigDir, getSessionCodexHome, persistSessionFork } from "../../persistence.ts";
import { addLogEntry, agents, emit, emitQueueUpdate, logCache, persistAll, updateState, rooms } from "../state.ts";
import { SessionSwappedError, createSession, replaceSession } from "../session/runtime.ts";
import { buildSessionEnv } from "../session/session-env.ts";
import { runAgentTurn } from "../../plugins/run-agent-turn.ts";
import { UsageCapError, usageCapMessage } from "../../usage-cap/member-usage-cap.ts";
import { persistCurrentSessionTopic } from "../topic.ts";
import { findUsageAtFork } from "../usage.ts";
import { inMultiStepFlow } from "../pending-prompt.ts";
import { sendMessage } from "./send.ts";
import {
  entriesBefore,
  findForkSourceSession,
  findOwnerSessionHint,
  findSdkUserMessageIndex,
  prefixedUserContent,
  topicMessageCount,
  userMessageMissingBecauseTurnWasStopped,
  userMessageOccurrenceIndex,
} from "./edit-helpers.ts";

export async function editMessage(agentId: string, logEntryId: string, newText: string, username?: string) {
  const managed = agents.get(agentId);
  if (!managed) return;
  if (managed.info.state !== "waiting_for_response" && managed.info.state !== "stopped") {
    addLogEntry(agentId, "error", "Cannot edit while agent is busy.");
    return;
  }

  const oldLogCache = [...(logCache.get(agentId) ?? [])];
  // Find target up front so the ephemeral short-circuit and the not-found
  // error can return before the fork pipeline runs.
  const targetEntry = oldLogCache.find((e) => e.id === logEntryId);
  if (!targetEntry || targetEntry.kind !== "user_message") {
    addLogEntry(agentId, "error", "Cannot edit: message not found.");
    return;
  }

  // Ephemeral entries (e.g. unknown / unsupported slash echoes) never reached
  // the backend transcript, so there is no fork point. Rewrite the failed
  // attempt by trimming it plus any trailing ephemeral siblings and
  // re-dispatching through sendMessage, which routes corrected slash text
  // back through the slash-command pipeline. Refuse if real turns or later
  // user messages follow — the user cannot selectively rewrite without also
  // discarding subsequent conversation.
  if (targetEntry.ephemeral) {
    // Multi-step flows (/resume, /model, /effort, permission prompts) leave
    // pending state expecting the next user message as the pick. Re-dispatching
    // via sendMessage would be consumed by that pending handler rather than
    // treated as a replacement. Force the user to answer or cancel first.
    if (inMultiStepFlow(managed)) {
      addLogEntry(agentId, "error", "Cannot edit: finish or cancel the pending prompt first.");
      return;
    }
    const targetPos = oldLogCache.findIndex((e) => e.id === logEntryId);
    const afterTarget = oldLogCache.slice(targetPos + 1);
    const hasRealAfter = afterTarget.some((e) => !e.ephemeral);
    const hasUserAfter = afterTarget.some((e) => e.kind === "user_message");
    if (hasRealAfter || hasUserAfter) {
      addLogEntry(agentId, "error", "Cannot edit: this message was not sent to the agent (later messages follow).");
      return;
    }
    const trimmed = oldLogCache.slice(0, targetPos);
    logCache.set(agentId, trimmed);
    emit({ type: "clear_logs", agentId });
    for (const entry of trimmed) {
      emit({ type: "log_entry", entry });
    }
    await sendMessage(agentId, newText, username);
    return;
  }

  // The fork pipeline below needs a backend session to fork from. Checked
  // here rather than at function entry so the ephemeral short-circuit above
  // can still fix a failed slash command in a session-less / first-message
  // state where sessionId is unset.
  if (!managed.sessionId) {
    addLogEntry(agentId, "error", "Cannot edit: no active session.");
    return;
  }
  if (managed.info.capabilities?.edit === false) {
    addLogEntry(agentId, "error", "Cannot edit: this agent's backend does not support editing a conversation. Send a new message instead.");
    return;
  }

  // Editing forks the conversation; queued messages were addressed to the
  // pre-edit context and should not bleed into the new branch. Mirrors /clear
  // and /resume.
  if (managed.messageQueue.length > 0) {
    managed.messageQueue = [];
    emitQueueUpdate(agentId, managed);
    persistAll();
  }

  const oldSessionId = managed.sessionId;
  persistCurrentSessionTopic(agentId, managed);
  const oldTopic = managed.info.topic;
  const oldTopicStale = managed.info.topicStale;

  try {
    // --- Phase 1: Fallible SDK operations (no UI/cache mutations yet) ---

    // 2. Get SDK session messages and match by content + occurrence index
    const env = buildSessionEnv(managed);
    const access = {
      environmentId: openCodeEnvironmentId(managed.info.userId, rooms[managed.info.room]?.id),
      cwd: managed.info.cwd,
      env: pinProviderEnvironment(managed, oldSessionId, env),
    };
    const backend = getBackend(managed.info.agentType);
    const sdkMessages = await backend.getSessionMessages(oldSessionId, managed.info.cwd, access);
    const prefixedContent = prefixedUserContent(targetEntry);
    const occurrenceIndex = userMessageOccurrenceIndex(oldLogCache, logEntryId, prefixedContent);

    // Match the edited message; each backend owns its exclusive cut semantics.
    const targetIdx = findSdkUserMessageIndex(sdkMessages, prefixedContent, occurrenceIndex);

    const stoppedBeforeBackendRecordedMessage = targetIdx === -1 && userMessageMissingBecauseTurnWasStopped(sdkMessages, oldLogCache, logEntryId);
    if (targetIdx === -1 && !stoppedBeforeBackendRecordedMessage) {
      // Walk the agent's on-disk sessions to find which one owns the entry,
      // so the error tells the user where the message actually lives. The
      // chat can show entries from a session that isn't the current backend
      // session — e.g. ContextMenu "New conversation" or message edits that
      // branched the timeline can leave entries from a prior session in view.
      const ownerHint = findOwnerSessionHint(agentId, oldSessionId, logEntryId);
      addLogEntry(agentId, "error", `Cannot edit: could not locate message in SDK session.${ownerHint}`);
      return;
    }

    // A missing, interrupted input was never recorded: preserve all backend
    // history. The backend decides whether an empty branch needs a fresh session.
    const forkResult = await backend.forkSessionBeforeMessage(oldSessionId, stoppedBeforeBackendRecordedMessage ? null : sdkMessages[targetIdx]!.uuid, access);
    const isFreshSession = forkResult.kind === "fresh";
    const newSessionId = forkResult.kind === "fork" ? forkResult.sessionId : "";

    // Linked branches preserve their parent, including first-message edits.
    if (!isFreshSession) {
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
      persistSessionFork(
        agentId,
        newSessionId,
        forkFromSessionId,
        logEntryId,
        oldTopic,
        parentTopicMessageCount,
        managed.info.cwd,
        getSessionClaudeConfigDir(agentId, oldSessionId) ?? undefined,
        parentBase,
        getSessionCodexHome(agentId, oldSessionId) ?? undefined,
      );
    }

    // 5. Create new session from fork (or fresh session), then close old
    const newSession = isFreshSession ? createSession(managed) : createSession(managed, newSessionId);
    await replaceSession(agentId, managed, newSession);
    // For fresh sessions, sessionId will be set by the system/init event (like newConversation).
    // For forks, set it now.
    managed.sessionId = isFreshSession ? null : newSessionId;
    managed.settingsNotice = null;
    managed.autoHandoffSpent = false;
    managed.autoHandoffFresh = false;
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
    //
    // The edit UI rewrites text only, so the original message's attachments
    // ride along to the replacement turn — dropping them would silently strip
    // the files the edited text is usually talking about.
    addLogEntry(agentId, "user_message", newText, username ? { username } : undefined, targetEntry.attachments);

    const prefixedNew = username ? `[${username}] ${newText}` : newText;
    await runAgentTurn({
      managed,
      visibleText: newText,
      // Raw replacement text is what the user actually wants the model to
      // see; sender prefix is bureau routing applied below.
      originalText: newText,
      sdkText: prefixedNew,
      username: username ?? null,
      attachments: targetEntry.attachments,
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
    if (err instanceof UsageCapError) {
      addLogEntry(agentId, "error", usageCapMessage(err));
      updateState(agentId, "waiting_for_response");
      persistAll();
      return;
    }
    if (!(err instanceof ProviderSignInRequiredError)) console.error(`Agent ${agentId} edit/fork error:`, err.message);

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

    if (err instanceof ProviderSignInRequiredError) {
      if (managed.session) managed.providerSignInBlockedSession = managed.session;
      updateState(agentId, "waiting_for_response");
      await emitLoginInstructions(agentId, managed);
      return;
    }
    addLogEntry(agentId, "error", `Failed to branch conversation: ${err.message}`);
    updateState(agentId, "error");
  }
}
