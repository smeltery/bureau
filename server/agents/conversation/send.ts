import type { Attachment } from "../../../shared/types.ts";
import { loadLogWithAncestors } from "../../persistence.ts";
import { addLogEntry, agents, emit, emitEphemeralLog, isAgentBusy, logCache, persistAll, updateState } from "../state.ts";
import { SessionSwappedError, createSession, installSession, replaceSession } from "../session/runtime.ts";
import { armDormantWakeNotice } from "../session/wake-notice.ts";
import { runAgentTurn } from "../../plugins/run-agent-turn.ts";
import { generateTopic, persistCurrentSessionTopic, shouldAutoRegenerateTopic, TOPIC_REGEN_THRESHOLD } from "../topic.ts";
import { handleSlashCommand } from "./slash-commands.ts";
import { enqueueUserMessage, QUEUE_MAX } from "./message-queue.ts";
import { handlePendingEffortPick, handlePendingModelPick } from "./pending-picks.ts";
import { resolvePermissionReply } from "./permission-reply.ts";

export async function sendMessage(agentId: string, text: string, username?: string, attachments?: Attachment[], userId?: string | null) {
  const managed = agents.get(agentId);
  if (!managed) return;
  // Queue the message if the agent is busy. Multi-step prompts (pendingResume
  // / model pick / permission) bypass the queue: the boss expects their input
  // to flow into the prompt immediately.
  if (isAgentBusy(managed.info.state) && !managed.pendingPermission && !managed.pendingResume && !managed.pendingModelPick && !managed.pendingEffortPick) {
    const queued = enqueueUserMessage(agentId, managed, text, username, attachments);
    if (!queued) {
      addLogEntry(agentId, "error", `Message queue is full (limit ${QUEUE_MAX}). Try again after the agent finishes.`);
    }
    return;
  }
  // If an abort is mid-handoff, wait for it to install the replacement session.
  // Without this, a follow-up message arriving in the gap between session.close()
  // and installSession sees session=null and falls into the recovery branch below,
  // amputating the agent's context.
  if (managed.abortPromise) {
    try {
      await managed.abortPromise;
    } catch {}
  }
  const isSlash = text.startsWith("/");
  // Skip auto-recovery for slash commands: they are control-plane actions
  // (/clear creates a fresh session, /resume picks from disk) and must stay
  // reachable when the data-plane session is broken. The recovery path below
  // re-runs createSession, which re-trips the same throw that killed the
  // previous session — blocking the user's escape hatch. Normal messages
  // still fall into the recovery path and surface the descriptive error.
  if (!managed.session && !isSlash) {
    // If the prior session ended owing a response, write the gap
    // breadcrumb before the recovery message lands. Parity with the
    // SDK's lazy synthetic placeholder so the user-visible log mirrors
    // the model's transcript on resume.
    const tail = (logCache.get(agentId) ?? []).at(-1);
    if (tail?.kind === "user_message") {
      addLogEntry(agentId, "system", "Previous response was interrupted.");
    }
    // Try to create a fresh session so the user's next message doesn't silently vanish.
    // Pass managed.sessionId so the new session resumes from the prior transcript when
    // possible — the previous session is genuinely dead, but the on-disk transcript is
    // still intact and worth restoring.
    try {
      const sessionId = managed.sessionId;
      // Snapshot the reason BEFORE installSession clears it: it decides whether
      // this wake is the calm idle-eviction one or a warning about a session
      // that died under the agent.
      const wakeReason = managed.dormantReason === "idle" ? "idle" : "session-ended";
      installSession(agentId, managed, sessionId ? createSession(managed, sessionId) : createSession(managed));
      // armDormantWakeNotice also arms managed.wakeNotice as a side effect: the
      // send below is the very one that carries it to the agent.
      addLogEntry(agentId, "system", sessionId ? armDormantWakeNotice(managed, wakeReason, sessionId) : "Started a fresh session (previous one could not be restored).");
      updateState(agentId, "waiting_for_response");
      // Fall through so the message is actually sent on the new session.
    } catch (err: any) {
      addLogEntry(agentId, "user_message", text, username ? { username } : undefined, attachments);
      addLogEntry(agentId, "error", `Cannot start session: ${err.message}\nType /clear to start fresh, or /resume to pick another session.`);
      updateState(agentId, "error");
      return;
    }
  }

  // Handle pending permission prompt: interpret reply as allow/deny.
  // Runs before slash-command interception by design — any typed slash command
  // while a prompt is pending is consumed as a deny reason, matching the
  // "anything else denies" contract shown to the user.
  if (managed.pendingPermission) {
    const pending = managed.pendingPermission;
    managed.pendingPermission = null;
    const userMeta = username ? { username } : undefined;
    emitEphemeralLog(agentId, "user_message", text, userMeta);
    // Option 4 ("allow, and stop asking about this prefix") is only recognized
    // when the backend advertised it on this approval — see resolvePermissionReply.
    const { decision, resumeState, note } = resolvePermissionReply(text, pending.allowPrefixLabel);
    if (note) emitEphemeralLog(agentId, "system", note);
    // The reply hands the turn back to the agent, so flip out of the
    // `waiting_for_response` state the prompt parked us in and back to a busy
    // state. Without this the activity indicator stays blank — `waiting_for_response`
    // has no STATE_LABELS entry — so the agent looks frozen while the backend
    // resumes (`tool_result` is deliberately state-neutral, so the blank window
    // otherwise lasts until the model's next thinking/text/tool_call event).
    // Allow → tool_executing (the blocked tool is about to run); deny → thinking
    // (the model resumes to handle the denial).
    //
    // This MUST precede `await session.approve()`: Codex's approve() awaits its
    // bootstrap promise, and while that's pending `pendingPermission` has already
    // been cleared. If we were still at `waiting_for_response` (a queue-idle
    // state) an inbound message could race into the active turn and skip the queue.
    updateState(agentId, resumeState);
    try {
      await managed.session?.approve(pending.approvalId, decision);
    } catch (err: any) {
      emitEphemeralLog(agentId, "error", `Failed to resolve permission: ${err?.message ?? String(err)}`);
      updateState(agentId, "error");
    }
    return;
  }

  // Handle /resume two-step: if pendingResume, check if input is a number pick
  if (managed.pendingResume) {
    managed.pendingResume = false;
    const trimmed = text.trim();
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= managed.pendingResumeSessions.length) {
      const userMeta = username ? { username } : undefined;
      emitEphemeralLog(agentId, "user_message", text, userMeta);
      const picked = managed.pendingResumeSessions[num - 1];
      managed.pendingResumeSessions = [];
      // Persist current session topic before switching
      persistCurrentSessionTopic(agentId, managed);
      // Perform the resume
      try {
        const newSession = createSession(managed, picked.sessionId);
        await replaceSession(agentId, managed, newSession);
        managed.sessionId = picked.sessionId;
        managed.topicGenerating = false;
        managed.contextNudgesSent.clear();
        managed.pendingContextNotices = [];
        managed.wakeNotice = null;
        managed.info.contextUsage = null;
        // Restore the textCount baseline from sessions.json so drift is
        // measured against the replayed history, not from zero (otherwise
        // any first new message after resume trivially trips the threshold).
        managed.topicMessageCount = picked.topicMessageCount;
        // Clear and replay resumed session's logs (walks fork ancestry)
        const history = loadLogWithAncestors(agentId, picked.sessionId);
        logCache.set(agentId, []);
        emit({ type: "clear_logs", agentId });
        if (history.length > 0) {
          logCache.set(agentId, [...history]);
          for (const entry of history) {
            emit({ type: "log_entry", entry });
          }
        }
        // Restore topic; topicStale reflects whether the replayed history has
        // moved past the topic's generation point.
        const replayedTextCount = history.filter((e) => e.kind === "user_message" || e.kind === "text").length;
        const drift = replayedTextCount - picked.topicMessageCount;
        managed.info.topic = picked.topic;
        managed.info.topicStale = drift > 0;
        emit({ type: "agent_updated", agentId, changes: { topic: picked.topic, topicStale: drift > 0, contextUsage: null } });
        emitEphemeralLog(agentId, "system", `Resumed session: ${picked.topic || picked.sessionId.slice(0, 8) + "..."}`);
        updateState(agentId, "waiting_for_response");
        persistAll();
        // Regenerate immediately if there's no topic at all, or if the
        // resumed conversation has drifted enough since the topic was last
        // generated. Waiting for the next user_message would let one stale
        // message through; firing here keeps the resumed agent's topic
        // honest from the moment the user sees it.
        if (!picked.topic || drift >= TOPIC_REGEN_THRESHOLD) {
          generateTopic(agentId);
        }
      } catch (err: any) {
        emitEphemeralLog(agentId, "error", `Failed to resume: ${err.message}`);
        updateState(agentId, "error");
      }
      return;
    } else {
      // Not a valid number — cancel pendingResume, process as normal
      managed.pendingResumeSessions = [];
      emitEphemeralLog(agentId, "system", "Resume cancelled.");
    }
  }

  if (await handlePendingModelPick(agentId, managed, text, username)) return;

  if (await handlePendingEffortPick(agentId, managed, text, username)) return;

  // Intercept slash commands that are handled locally, not by the LLM
  if (isSlash) {
    const [cmd, ...args] = text.slice(1).trim().split(/\s+/);
    const handled = await handleSlashCommand(agentId, managed, cmd, args, text, username, userId);
    if (handled) return;
  }

  addLogEntry(agentId, "user_message", text, username ? { username } : undefined, attachments);

  // First-message bootstrap (topic === null) OR drift-driven refresh after
  // resume/restart/long session (shouldAutoRegenerateTopic). The threshold
  // inside the helper keeps cost bounded to ~one regen per
  // TOPIC_REGEN_THRESHOLD new user/text entries.
  if ((managed.info.topic === null || shouldAutoRegenerateTopic(managed)) && !managed.topicGenerating) {
    generateTopic(agentId); // fire-and-forget
  }

  const prefixedText = username ? `[${username}] ${text}` : text;
  try {
    await runAgentTurn({
      managed,
      visibleText: text,
      // sendMessage's raw user text is `text`; the sender prefix is
      // applied above as `prefixedText` which becomes sdkText.
      originalText: text,
      sdkText: prefixedText,
      username: username ?? null,
      attachments,
      origin: "user",
      humanInput: true,
    });
  } catch (err: any) {
    // runAgentTurn re-throws whatever the underlying turn threw; it also
    // handles the deferred-cleanup invariant (rejecting managed.pendingTurn
    // if session.send threw before await turn ran). The per-call-site catch
    // remains responsible for the distinct error semantics each path needs.
    if (err instanceof SessionSwappedError) return;
    console.error(`Agent ${agentId} send error:`, err.message);
    addLogEntry(agentId, "error", `Error: ${err.message}`);
    updateState(agentId, "error");
  }
}
