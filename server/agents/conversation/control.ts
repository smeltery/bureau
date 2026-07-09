import { listAgentSessions, loadLogWithAncestors, getSessionCwd, persistSessionCwd, ensureSessionCwd } from "../../persistence.ts";
import { addLogEntry, agents, emit, logCache, persistAll, updateState, type ManagedAgent } from "../state.ts";
import { createSession, replaceSession } from "../session/runtime.ts";
import { validateCwd } from "../session/paths.ts";
import { errMessage } from "../../../shared/errors.ts";
import { generateTopic, persistCurrentSessionTopic, TOPIC_REGEN_THRESHOLD } from "../topic.ts";
import { flushQueue } from "./send.ts";

// cwd is a property of the session (source of truth in sessions.json); the
// agent's info.cwd is just a denormalized mirror. Before resuming a session,
// switch the mirror to that session's stored cwd so createSession spawns the
// backend in the directory the session actually ran in — Claude finds its
// .jsonl under the matching project dir, and the transcript's recorded paths
// line up. Returns the previous cwd, whether the switch happened (so a failed
// resume can roll back), and whether the stored cwd was present-but-invalid (so
// the caller can REPAIR the bad metadata after a fallback resume — otherwise the
// invalid value is sticky and every future resume repeats the same fallback).
// Legacy sessions with no stored cwd leave the mirror untouched; the caller
// backfills via ensureSessionCwd.
function applySessionCwdForResume(agentId: string, managed: ManagedAgent, sessionId: string): { prevCwd: string; switched: boolean; storedCwdInvalid: boolean } {
  const prevCwd = managed.info.cwd;
  const storedCwd = getSessionCwd(agentId, sessionId);
  if (!storedCwd || storedCwd === prevCwd) return { prevCwd, switched: false, storedCwdInvalid: false };
  try {
    const resolvedStored = validateCwd(storedCwd);
    managed.info.cwd = resolvedStored;
    emit({ type: "agent_updated", agentId, changes: { cwd: resolvedStored } });
    return { prevCwd, switched: true, storedCwdInvalid: false };
  } catch (err) {
    // Stored cwd is gone/invalid — resume in the current mirror cwd instead of
    // failing, and tell the user. createSession's own preflight still validates
    // cwd and (for Claude) the session file's presence.
    addLogEntry(agentId, "system", `Session's saved directory \`${storedCwd}\` is unavailable (${errMessage(err)}); resuming in \`${prevCwd}\`.`);
    return { prevCwd, switched: false, storedCwdInvalid: true };
  }
}

// Record the cwd a session actually resumed in. Repairs a present-but-invalid
// stored cwd (overwrite) so it isn't sticky; otherwise backfills a legacy/
// missing value without clobbering or reordering an existing valid one.
function recordResumedSessionCwd(agentId: string, sessionId: string, cwd: string, storedCwdInvalid: boolean) {
  if (storedCwdInvalid) persistSessionCwd(agentId, sessionId, cwd);
  else ensureSessionCwd(agentId, sessionId, cwd);
}

// Roll the mirror cwd back after a failed resume (pairs with
// applySessionCwdForResume) so the agent isn't left pointing at a cwd for a
// session that didn't actually resume.
function rollbackSessionCwd(agentId: string, managed: ManagedAgent, prevCwd: string) {
  managed.info.cwd = prevCwd;
  emit({ type: "agent_updated", agentId, changes: { cwd: prevCwd } });
}

export async function abort(agentId: string) {
  const managed = agents.get(agentId);
  if (!managed) return;
  // Bump the cancel token unconditionally. Stop is always a cancellation
  // event from the runAgentTurn pre-send window's perspective — whether
  // the agent is mid-plugin-retrieval (no pendingTurn yet) or mid-real-
  // turn (pendingTurn installed), the token bump is the signal that
  // tells runAgentTurn to bail before session.send if it hasn't run yet.
  // For the post-send path the existing pendingTurn rejection (below) is
  // still the cancellation mechanism; the token bump is harmless there.
  managed.turnCancelToken++;
  // If no turn is in flight, the SDK stream may have died (e.g. subprocess
  // exited) OR runAgentTurn may be mid-plugin-retrieval. Either way reset
  // state so Stop is never a no-op.
  if (!managed.pendingTurn) {
    if (managed.info.state === "thinking" || managed.info.state === "tool_executing") {
      updateState(agentId, "waiting_for_response");
      addLogEntry(agentId, "system", "Agent interrupted.");
    }
    return;
  }
  managed.aborting = true;
  let abortDone!: () => void;
  managed.abortPromise = new Promise<void>((res) => {
    abortDone = res;
  });
  const sessionId = managed.sessionId;

  // Flip UI state and log the interrupt up front so the agent appears to
  // stop immediately. The SDK's close() takes a few seconds to actually
  // drain, but runConsumer suppresses events from the dying session — so
  // from the user's perspective the agent stops on Ctrl+C, matching the
  // Claude Code interactive behavior.
  updateState(agentId, "waiting_for_response");
  addLogEntry(agentId, "system", "Agent interrupted.");

  try {
    const newSession = sessionId ? createSession(managed, sessionId) : createSession(managed);
    await replaceSession(agentId, managed, newSession);
  } catch (err: any) {
    addLogEntry(agentId, "error", `Failed to resume after interrupt: ${err.message}`);
    updateState(agentId, "error");
  } finally {
    managed.aborting = false;
    managed.abortPromise = null;
    abortDone();
  }
}

export async function sendNow(agentId: string) {
  const managed = agents.get(agentId);
  if (!managed) return;
  if (managed.messageQueue.length === 0) return;
  if (managed.info.state === "thinking" || managed.info.state === "tool_executing") {
    await abort(agentId);
  }
  await flushQueue(agentId);
}

export async function newConversation(agentId: string) {
  const managed = agents.get(agentId);
  if (!managed) return;
  managed.pendingResume = false;
  managed.pendingResumeSessions = [];
  managed.pendingModelPick = false;
  managed.pendingEffortPick = false;
  persistCurrentSessionTopic(agentId, managed);

  try {
    const newSession = createSession(managed);
    await replaceSession(agentId, managed, newSession);
    managed.sessionId = null;
    managed.topicGenerating = false;
    managed.topicMessageCount = 0;
    managed.info.topic = null;
    managed.info.topicStale = false;
    emit({ type: "agent_updated", agentId, changes: { topic: null, topicStale: false } });
    // Match /clear's behavior: wipe the chat. Without this, the timeline
    // continues across session boundaries and editing an old entry hits
    // the cross-session dead-end.
    logCache.set(agentId, []);
    emit({ type: "clear_logs", agentId } as any);
    updateState(agentId, "idle");
    addLogEntry(agentId, "system", "New conversation started.");
    persistAll();
  } catch (err: any) {
    addLogEntry(agentId, "error", `Failed to start new conversation: ${err.message}`);
    updateState(agentId, "error");
  }
}

export async function resume(agentId: string, sessionId: string) {
  const managed = agents.get(agentId);
  if (!managed) return;
  managed.pendingResume = false;
  managed.pendingResumeSessions = [];
  managed.pendingModelPick = false;
  managed.pendingEffortPick = false;
  persistCurrentSessionTopic(agentId, managed);

  try {
    // cwd is a property of the session: restore the cwd this session ran in
    // before spawning (transactional — rolled back below if the resume fails).
    const { prevCwd, switched, storedCwdInvalid } = applySessionCwdForResume(agentId, managed, sessionId);
    let newSession;
    try {
      newSession = createSession(managed, sessionId);
      await replaceSession(agentId, managed, newSession);
    } catch (err) {
      if (switched) rollbackSessionCwd(agentId, managed, prevCwd);
      throw err;
    }
    managed.sessionId = sessionId;
    // Record the cwd we actually resumed in: backfill a legacy/missing value, or
    // repair a present-but-invalid one so it isn't sticky on future resumes.
    recordResumedSessionCwd(agentId, sessionId, managed.info.cwd, storedCwdInvalid);
    managed.topicGenerating = false;

    // Clear and replay resumed session's logs (walks fork ancestry for branched sessions)
    const history = loadLogWithAncestors(agentId, sessionId);
    logCache.set(agentId, []);
    emit({ type: "clear_logs", agentId } as any);
    if (history.length > 0) {
      logCache.set(agentId, [...history]);
      for (const entry of history) {
        emit({ type: "log_entry", entry });
      }
    }

    // Restore topic + topicMessageCount baseline from sessions.json so drift
    // can be measured against the replayed history.
    const sessions = listAgentSessions(agentId);
    const sessionEntry = sessions.find((s) => s.sessionId === sessionId);
    const restoredTopic = sessionEntry?.topic ?? null;
    const restoredCount = sessionEntry?.topicMessageCount ?? 0;
    managed.topicMessageCount = restoredCount;
    const replayedTextCount = history.filter((e) => e.kind === "user_message" || e.kind === "text").length;
    const drift = replayedTextCount - restoredCount;
    managed.info.topic = restoredTopic;
    managed.info.topicStale = drift > 0;
    emit({ type: "agent_updated", agentId, changes: { topic: managed.info.topic, topicStale: drift > 0 } });

    updateState(agentId, "waiting_for_response");
    addLogEntry(agentId, "system", `Resumed session: ${restoredTopic || sessionId.slice(0, 8) + "..."}`);
    persistAll();

    // Regenerate now (rather than waiting for the next user_message) if the
    // topic is missing or the replayed history has drifted past the
    // refresh threshold — same policy as the /resume two-step flow above.
    if (!restoredTopic || drift >= TOPIC_REGEN_THRESHOLD) {
      generateTopic(agentId);
    }
  } catch (err: any) {
    addLogEntry(agentId, "error", `Failed to resume: ${err.message}`);
    updateState(agentId, "error");
  }
}
