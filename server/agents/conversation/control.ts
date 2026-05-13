import { listAgentSessions, loadLogWithAncestors } from "../../persistence.ts";
import { addLogEntry, agents, emit, logCache, persistAll, updateState } from "../state.ts";
import { createSession, replaceSession } from "../session/runtime.ts";
import { generateTopic, persistCurrentSessionTopic } from "../topic.ts";

export async function abort(agentId: string) {
  const managed = agents.get(agentId);
  if (!managed) return;
  // If no turn is in flight, the SDK stream may have died (e.g. subprocess
  // exited) while the UI still shows "thinking". Reset state so Stop is
  // never a no-op.
  if (!managed.pendingTurn) {
    if (managed.info.state === "thinking" || managed.info.state === "tool_executing") {
      updateState(agentId, "waiting_for_response");
      addLogEntry(agentId, "system", "Agent interrupted (stream was already dead — state reset).");
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

export async function newConversation(agentId: string) {
  const managed = agents.get(agentId);
  if (!managed) return;
  managed.pendingResume = false;
  managed.pendingResumeSessions = [];
  managed.pendingModelPick = false;
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
  persistCurrentSessionTopic(agentId, managed);

  try {
    const newSession = createSession(managed, sessionId);
    await replaceSession(agentId, managed, newSession);
    managed.sessionId = sessionId;
    managed.topicGenerating = false;
    managed.topicMessageCount = 0;

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

    // Restore topic from sessions.json
    const sessions = listAgentSessions(agentId);
    const sessionEntry = sessions.find((s) => s.sessionId === sessionId);
    managed.info.topic = sessionEntry?.topic ?? null;
    managed.info.topicStale = false;
    emit({ type: "agent_updated", agentId, changes: { topic: managed.info.topic, topicStale: false } });

    updateState(agentId, "waiting_for_response");
    addLogEntry(agentId, "system", `Resumed session: ${managed.info.topic || sessionId.slice(0, 8) + "..."}`);
    persistAll();

    // If no topic, regenerate from session logs
    if (!managed.info.topic) {
      generateTopic(agentId);
    }
  } catch (err: any) {
    addLogEntry(agentId, "error", `Failed to resume: ${err.message}`);
    updateState(agentId, "error");
  }
}
