import type { Attachment } from "../../../shared/types.ts";
import { MODEL_FAMILIES, familyDisplayLabel } from "../../../shared/types.ts";
import { loadLogWithAncestors } from "../../persistence.ts";
import {
  addLogEntry,
  agents,
  emit,
  emitEphemeralLog,
  logCache,
  persistAll,
  updateState,
} from "../state.ts";
import { buildUserMessage } from "../session/messages.ts";
import {
  SessionSwappedError,
  createSession,
  createTurnDeferred,
  installSession,
  replaceSession,
} from "../session/runtime.ts";
import { generateTopic, persistCurrentSessionTopic } from "../topic.ts";
import { handleSlashCommand } from "./slash-commands.ts";

export async function sendMessage(agentId: string, text: string, username?: string, attachments?: Attachment[]) {
  const managed = agents.get(agentId);
  if (!managed) return;
  if (!managed.session) {
    // Try to create a fresh session so the user's next message doesn't silently vanish.
    try {
      installSession(agentId, managed, createSession(managed));
      managed.sessionId = null;
      addLogEntry(agentId, "system", "Started a fresh session (previous one could not be restored).");
      updateState(agentId, "waiting_for_response");
      // Fall through so the message is actually sent on the new session.
    } catch (err: any) {
      addLogEntry(agentId, "user_message", text, username ? { username } : undefined, attachments);
      addLogEntry(agentId, "error", `Cannot start session: ${err.message}`);
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
    const trimmed = text.trim();
    if (trimmed === "1") {
      // Scope suggested rules to this session only so they don't leak across sessions.
      const sessionScoped = pending.suggestions?.map((s) => ({ ...s, destination: "session" as const }));
      emitEphemeralLog(agentId, "system", "Permission granted (rule added for this session).");
      pending.resolve({ behavior: "allow", updatedInput: pending.input, updatedPermissions: sessionScoped });
    } else if (trimmed === "2") {
      emitEphemeralLog(agentId, "system", "Permission granted (once).");
      pending.resolve({ behavior: "allow", updatedInput: pending.input });
    } else if (trimmed === "3") {
      emitEphemeralLog(agentId, "system", "Permission denied.");
      pending.resolve({ behavior: "deny", message: "User denied." });
    } else {
      emitEphemeralLog(agentId, "system", "Permission denied with reason forwarded to agent.");
      pending.resolve({ behavior: "deny", message: text });
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
        managed.topicMessageCount = 0;
        // Clear and replay resumed session's logs (walks fork ancestry)
        const history = loadLogWithAncestors(agentId, picked.sessionId);
        logCache.set(agentId, []);
        emit({ type: "clear_logs", agentId } as any);
        if (history.length > 0) {
          logCache.set(agentId, [...history]);
          for (const entry of history) {
            emit({ type: "log_entry", entry });
          }
        }
        // Restore topic
        managed.info.topic = picked.topic;
        managed.info.topicStale = false;
        emit({ type: "agent_updated", agentId, changes: { topic: picked.topic, topicStale: false } });
        emitEphemeralLog(agentId, "system", `Resumed session: ${picked.topic || picked.sessionId.slice(0, 8) + "..."}`);
        updateState(agentId, "waiting_for_response");
        persistAll();
        if (!picked.topic) {
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

  // Handle /model two-step: if pendingModelPick, check if input is a number pick
  if (managed.pendingModelPick) {
    managed.pendingModelPick = false;
    const trimmed = text.trim();
    const num = parseInt(trimmed, 10);
    if (!isNaN(num) && num >= 1 && num <= MODEL_FAMILIES.length) {
      const userMeta = username ? { username } : undefined;
      emitEphemeralLog(agentId, "user_message", text, userMeta);
      const picked = MODEL_FAMILIES[num - 1];
      const label = familyDisplayLabel(picked.family);
      if (picked.family === managed.info.modelFamily) {
        emitEphemeralLog(agentId, "system", `Already using ${label}.`);
      } else {
        managed.info.modelFamily = picked.family;
        const sessionId = managed.sessionId;
        const newSession = sessionId ? createSession(managed, sessionId) : createSession(managed);
        await replaceSession(agentId, managed, newSession);
        emit({ type: "agent_updated", agentId, changes: { modelFamily: picked.family } });
        persistAll();
        addLogEntry(agentId, "system", `Model switched to ${label}. The agent's context may still say they are a different model — the correct model is shown in the top bar.`);
      }
      return;
    } else {
      emitEphemeralLog(agentId, "system", "Model selection cancelled.");
    }
  }

  // Intercept slash commands that are handled locally, not by the LLM
  if (text.startsWith("/")) {
    const [cmd, ...args] = text.slice(1).trim().split(/\s+/);
    const handled = await handleSlashCommand(agentId, managed, cmd, args, text, username);
    if (handled) return;
  }

  addLogEntry(agentId, "user_message", text, username ? { username } : undefined, attachments);
  updateState(agentId, "thinking");

  // Auto-generate topic on first user message in a conversation
  if (managed.info.topic === null && !managed.topicGenerating) {
    generateTopic(agentId); // fire-and-forget
  }

  const prefixedText = username ? `[${username}] ${text}` : text;
  try {
    const turn = createTurnDeferred(managed);
    if (attachments && attachments.length > 0) {
      const message = buildUserMessage(agentId, prefixedText, attachments);
      await managed.session!.send(message);
    } else {
      await managed.session!.send(prefixedText);
    }
    await turn;
  } catch (err: any) {
    if (err instanceof SessionSwappedError) return;
    console.error(`Agent ${agentId} send error:`, err.message);
    addLogEntry(agentId, "error", `Error: ${err.message}`);
    updateState(agentId, "error");
  }
}
