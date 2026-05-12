import type { Attachment, QueuedMessage, QueuedSender } from "../../../shared/types.ts";
import { MODEL_FAMILIES, familyDisplayLabel } from "../../../shared/types.ts";
import { formatAgentSenderPrefix, formatUserPrefix } from "../../../shared/identity.ts";
import { loadLogWithAncestors } from "../../persistence.ts";
import { addLogEntry, agents, emit, emitEphemeralLog, emitQueueUpdate, isAgentBusy, logCache, persistAll, updateState, type ManagedAgent } from "../state.ts";
import { buildUserMessage } from "../session/messages.ts";
import { SessionSwappedError, createSession, createTurnDeferred, installSession, replaceSession } from "../session/runtime.ts";
import { generateTopic, persistCurrentSessionTopic } from "../topic.ts";
import { handleSlashCommand } from "./slash-commands.ts";

const QUEUE_MAX = 50;

function generateQueuedId(existing: QueuedMessage[]): string {
  // 6-char hex; retry on collision (extremely unlikely with a Map<= QUEUE_MAX)
  for (let i = 0; i < 8; i++) {
    const id = Math.random().toString(16).slice(2, 8);
    if (!existing.some((m) => m.id === id)) return id;
  }
  return `${Date.now().toString(16).slice(-6)}`;
}

// Single entry point for both human (textarea via sendMessage) and agent
// (HTTP POST /agents/:id/message) senders. Decides whether to queue or
// flush-immediately based on the receiver's state. Rejects `error` /
// `stopped` agents with 409. The textarea path (sendMessage) is more
// permissive — it has its own session-recovery branch — but agents
// benefit from an explicit failure so they can retry or fall back.
export type EnqueueResult = { ok: true; queued: boolean; messageId: string } | { ok: false; error: string; status: number };

export function enqueueMessage(receiverId: string, msg: { sender: QueuedSender; text: string; attachments?: Attachment[] }): EnqueueResult {
  const managed = agents.get(receiverId);
  if (!managed) return { ok: false, error: "agent not found", status: 404 };
  const state = managed.info.state;
  if (state === "error" || state === "stopped") {
    return { ok: false, error: "agent is not accepting messages", status: 409 };
  }
  if (managed.messageQueue.length >= QUEUE_MAX) {
    return { ok: false, error: `queue full (limit ${QUEUE_MAX})`, status: 429 };
  }
  const id = generateQueuedId(managed.messageQueue);
  managed.messageQueue.push({
    id,
    sender: msg.sender,
    text: msg.text,
    attachments: msg.attachments,
    queuedAt: Date.now(),
  });
  emitQueueUpdate(receiverId, managed);
  // Receiver is idle: flush right away so the message lands without a
  // user gesture. flushQueue is safe to call here — it re-checks state.
  if (!isAgentBusy(state) && !managed.pendingPermission && !managed.pendingResume && !managed.pendingModelPick) {
    flushQueue(receiverId).catch((err: any) => {
      console.error(`flushQueue (post-enqueue) failed for ${receiverId}:`, err.message);
    });
    return { ok: true, queued: false, messageId: id };
  }
  return { ok: true, queued: true, messageId: id };
}

function senderPrefixText(sender: QueuedSender): string {
  switch (sender.kind) {
    case "user":
      return formatUserPrefix(sender.username);
    case "agent":
      return `${formatAgentSenderPrefix(sender.agentId, sender.agentName, sender.roomName)} `;
  }
}

function senderMeta(sender: QueuedSender): Record<string, unknown> | undefined {
  switch (sender.kind) {
    case "user":
      return sender.username ? { username: sender.username } : undefined;
    case "agent":
      return {
        sender_agent_id: sender.agentId,
        sender_agent_name: sender.agentName,
        sender_agent_room: sender.roomName,
      };
  }
}

function enqueueUserMessage(agentId: string, managed: ManagedAgent, text: string, username: string | undefined, attachments: Attachment[] | undefined): boolean {
  if (managed.messageQueue.length >= QUEUE_MAX) return false;
  const item: QueuedMessage = {
    id: generateQueuedId(managed.messageQueue),
    sender: { kind: "user", username },
    text,
    attachments,
    queuedAt: Date.now(),
  };
  managed.messageQueue.push(item);
  emitQueueUpdate(agentId, managed);
  return true;
}

// Flush the per-agent message queue. Combines all queued items into one
// SDK send (each item is also written as its own user_message log entry so
// chat history shows them as individual turns). Called from updateState
// when the agent transitions to a non-busy state.
export async function flushQueue(agentId: string): Promise<void> {
  const managed = agents.get(agentId);
  if (!managed) return;
  if (managed.flushInProgress) return;
  if (managed.messageQueue.length === 0) return;
  if (isAgentBusy(managed.info.state)) return;
  if (managed.pendingPermission || managed.pendingResume || managed.pendingModelPick) return;

  managed.flushInProgress = true;
  try {
    // If the session died mid-flight (e.g. server restart between
    // enqueue and flush), resume the prior transcript so the queued
    // messages aren't sent into the void. The breadcrumb mirrors the
    // SDK's lazy synthetic placeholder so the model's transcript and
    // the user-visible log stay in sync on resume.
    if (!managed.session) {
      const tail = (logCache.get(agentId) ?? []).at(-1);
      if (tail?.kind === "user_message") {
        addLogEntry(agentId, "system", "Previous response was interrupted.");
      }
      try {
        const sessionId = managed.sessionId;
        installSession(agentId, managed, sessionId ? createSession(managed, sessionId) : createSession(managed));
        addLogEntry(agentId, "system", sessionId ? "Resumed prior session before flushing queued messages." : "Started a fresh session before flushing queued messages.");
      } catch (err: any) {
        addLogEntry(agentId, "error", `Cannot start session to flush queue: ${err.message}`);
        updateState(agentId, "error");
        return;
      }
    }
    const items = managed.messageQueue.slice();
    managed.messageQueue = [];
    emitQueueUpdate(agentId, managed);
    // Combine with sender-kind-specific prefixes so the agent can tell
    // human bosses from other agents apart.
    const promptParts: string[] = [];
    const allAttachments: Attachment[] = [];
    for (const m of items) {
      promptParts.push(`${senderPrefixText(m.sender)}${m.text}`);
      if (m.attachments) allAttachments.push(...m.attachments);
    }
    const prompt = promptParts.join("\n\n");
    // Log each item separately so it shows up as its own chat bubble.
    for (const m of items) {
      addLogEntry(agentId, "user_message", m.text, senderMeta(m.sender), m.attachments);
    }
    updateState(agentId, "thinking");
    try {
      const turn = createTurnDeferred(managed);
      if (allAttachments.length > 0) {
        const message = buildUserMessage(agentId, prompt, allAttachments);
        await managed.session!.send(message);
      } else {
        await managed.session!.send(prompt);
      }
      await turn;
    } catch (err: any) {
      if (err instanceof SessionSwappedError) return;
      addLogEntry(agentId, "error", `Error flushing queue: ${err.message}`);
      updateState(agentId, "error");
    }
  } finally {
    managed.flushInProgress = false;
  }
}

// Remove a queued message by id. Called from the dequeue_message WS command.
export function dequeueMessage(agentId: string, queuedId: string): boolean {
  const managed = agents.get(agentId);
  if (!managed) return false;
  const before = managed.messageQueue.length;
  managed.messageQueue = managed.messageQueue.filter((m) => m.id !== queuedId);
  if (managed.messageQueue.length === before) return false;
  emitQueueUpdate(agentId, managed);
  return true;
}

export async function sendMessage(agentId: string, text: string, username?: string, attachments?: Attachment[]) {
  const managed = agents.get(agentId);
  if (!managed) return;
  // Queue the message if the agent is busy. Multi-step prompts (pendingResume
  // / model pick / permission) bypass the queue: the boss expects their input
  // to flow into the prompt immediately.
  if (isAgentBusy(managed.info.state) && !managed.pendingPermission && !managed.pendingResume && !managed.pendingModelPick) {
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
  if (!managed.session) {
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
      installSession(agentId, managed, sessionId ? createSession(managed, sessionId) : createSession(managed));
      addLogEntry(agentId, "system", sessionId ? "Resumed prior session after the previous one ended unexpectedly." : "Started a fresh session (previous one could not be restored).");
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
