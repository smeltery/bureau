import { listAgentSessions, loadLogWithAncestors, getSessionCwd, persistSessionCwd, ensureSessionCwd } from "../../persistence.ts";
import { addLogEntry, agents, emit, isAgentBusy, logCache, persistAll, updateState, type ManagedAgent } from "../state.ts";
import { createSession, replaceSession } from "../session/runtime.ts";
import { validateCwd } from "../session/paths.ts";
import { errMessage } from "../../../shared/errors.ts";
import { generateTopic, persistCurrentSessionTopic, TOPIC_REGEN_THRESHOLD } from "../topic.ts";
import { flushQueue, enqueueMessage, steerRateLimited, type EnqueueResult } from "./message-queue.ts";
import { getAgentDisplay } from "../lifecycle.ts";

const handoffInProgress = new Set<string>();

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

// An agent's stop delivers no message that could explain it, so the target's
// next turn carries this note instead.
export const AGENT_STOP_NOTICE =
  "Bureau: another agent stopped your previous turn. Any rejection or interruption text at the end of that turn came from that stop, not from a human. A tool call cut short may have done partial work: check its effects before you continue.";

export type AgentAbortResult = { ok: true } | { ok: false; status: 404 | 409 | 429; error: string };

// A stop requested with an agent token. It shares the steer window, because
// the limit protects the receiver's ability to finish a turn whatever the
// interruption is called. Joining a stop already in flight, or finding nothing
// to stop, spends no slot. The note is armed before the abort so a queued flush
// that starts as the abort settles still carries it.
export async function abortByAgent(agentId: string): Promise<AgentAbortResult> {
  const managed = agents.get(agentId);
  if (!managed) return { ok: false, status: 404, error: "agent not found" };
  if (managed.aborting && managed.abortPromise) {
    await managed.abortPromise;
    return { ok: true };
  }
  if (!managed.pendingTurn && !isAgentBusy(managed.info.state)) return { ok: false, status: 409, error: "nothing to stop" };
  if (steerRateLimited(managed)) return { ok: false, status: 429, error: "this agent was interrupted too often in the last minute; try again later" };
  managed.recentSteers.push(Date.now());
  managed.pendingContextNotices.push(AGENT_STOP_NOTICE);
  await abort(agentId);
  return { ok: true };
}

export async function sendNow(agentId: string) {
  const managed = agents.get(agentId);
  if (!managed) return;
  managed.providerSignInBlockedSession = undefined;
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
  managed.pendingCronjobPick = false;
  persistCurrentSessionTopic(agentId, managed);

  try {
    const newSession = createSession(managed);
    await replaceSession(agentId, managed, newSession);
    managed.sessionId = null;
    managed.topicGenerating = false;
    managed.topicMessageCount = 0;
    managed.contextNudgesSent.clear();
    managed.firedUiThresholds.clear();
    managed.pendingContextNotices = [];
    managed.wakeNotice = null;
    managed.memoryNotice = null;
    managed.memoryNoticeFired = false;
    managed.info.topic = null;
    managed.info.topicStale = false;
    managed.info.contextUsage = null;
    emit({ type: "agent_updated", agentId, changes: { topic: null, topicStale: false, contextUsage: null } });
    // Match /clear's behavior: wipe the chat. Without this, the timeline
    // continues across session boundaries and editing an old entry hits
    // the cross-session dead-end.
    logCache.set(agentId, []);
    emit({ type: "clear_logs", agentId });
    updateState(agentId, "idle");
    addLogEntry(agentId, "system", "New conversation started.");
    persistAll();
  } catch (err: any) {
    addLogEntry(agentId, "error", `Failed to start new conversation: ${err.message}`);
    updateState(agentId, "error");
  }
}

// A handoff keeps the queue: the fresh session gets the brief first, then every
// queued message. Hold flushes while the session swaps; the "queued during your
// previous turn" note means nothing to a session with no previous turn.
export function holdQueueForHandoff(managed: ManagedAgent): void {
  managed.flushHeld = true;
  managed.messageQueue = managed.messageQueue.map(({ queuedDuringBusyTurn: _, ...item }) => item);
}

export function releaseQueueAfterHandoff(agentId: string, managed: ManagedAgent): void {
  managed.flushHeld = false;
  if (managed.messageQueue.length > 0 && !isAgentBusy(managed.info.state)) {
    flushQueue(agentId).catch((err: any) => console.error(`flushQueue (after handoff) failed for ${agentId}:`, err.message));
  }
}

export async function handoff(agentId: string, text: string): Promise<EnqueueResult> {
  const managed = agents.get(agentId);
  if (!managed) return { ok: false, error: "agent not found", status: 404 };
  if (handoffInProgress.has(agentId)) return { ok: false, error: "handoff_in_progress", status: 409 };
  handoffInProgress.add(agentId);
  holdQueueForHandoff(managed);
  try {
    await newConversation(agentId);
    const self = getAgentDisplay(agentId);
    if (!self) return { ok: false, error: "agent not found", status: 404 };
    managed.flushHeld = false;
    return enqueueMessage(agentId, { sender: { kind: "agent", agentId, agentName: self.name, roomName: self.roomName }, text, handoff: true }, { atHead: true });
  } finally {
    handoffInProgress.delete(agentId);
    releaseQueueAfterHandoff(agentId, managed);
  }
}

export async function resume(agentId: string, sessionId: string) {
  const managed = agents.get(agentId);
  if (!managed) return;
  managed.pendingResume = false;
  managed.pendingResumeSessions = [];
  managed.pendingModelPick = false;
  managed.pendingEffortPick = false;
  managed.pendingCronjobPick = false;
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
    managed.contextNudgesSent.clear();
    managed.firedUiThresholds.clear();
    managed.pendingContextNotices = [];
    managed.wakeNotice = null;
    managed.memoryNotice = null;
    managed.memoryNoticeFired = false;
    managed.info.contextUsage = null;
    // Record the cwd we actually resumed in: backfill a legacy/missing value, or
    // repair a present-but-invalid one so it isn't sticky on future resumes.
    recordResumedSessionCwd(agentId, sessionId, managed.info.cwd, storedCwdInvalid);
    managed.topicGenerating = false;

    // Clear and replay resumed session's logs (walks fork ancestry for branched sessions)
    const history = loadLogWithAncestors(agentId, sessionId);
    logCache.set(agentId, []);
    emit({ type: "clear_logs", agentId });
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
    emit({ type: "agent_updated", agentId, changes: { topic: managed.info.topic, topicStale: drift > 0, contextUsage: null } });

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
