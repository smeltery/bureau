import type { Attachment, QueuedMessage, QueuedSender } from "../../../shared/types.ts";
import { formatAgentSenderPrefix, formatUserPrefix } from "../../../shared/identity.ts";
import { addLogEntry, agents, emitQueueUpdate, isAgentBusy, logCache, updateState, type ManagedAgent } from "../state.ts";
import { SessionSwappedError, createSession, installSession } from "../session/runtime.ts";
import { runAgentTurn } from "../../plugins/run-agent-turn.ts";

export const QUEUE_MAX = 50;

function generateQueuedId(existing: QueuedMessage[]): string {
  // 6-char hex; retry on collision (extremely unlikely with a Map<= QUEUE_MAX)
  for (let i = 0; i < 8; i++) {
    const id = Math.random().toString(16).slice(2, 8);
    if (!existing.some((m) => m.id === id)) return id;
  }
  return `${Date.now().toString(16).slice(-6)}`;
}

// Single entry point for both human (textarea via sendMessage) and agent
// (HTTP POST /api/agents/:id/message) senders. Decides whether to queue or
// flush-immediately based on the receiver's state. Rejects `error` /
// `stopped` agents with 409. The textarea path (sendMessage) is more
// permissive; it has its own session-recovery branch, but agents benefit from
// an explicit failure so they can retry or fall back.
export type EnqueueResult = { ok: true; queued: boolean; messageId: string } | { ok: false; error: string; status: number };

export function enqueueMessage(receiverId: string, msg: { sender: QueuedSender; text: string; sdkText?: string; attachments?: Attachment[] }): EnqueueResult {
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
  const canFlushNow = !isAgentBusy(state) && !managed.pendingPermission && !managed.pendingResume && !managed.pendingModelPick && !managed.pendingEffortPick;
  managed.messageQueue.push({
    id,
    sender: msg.sender,
    text: msg.text,
    ...(msg.sdkText ? { sdkText: msg.sdkText } : {}),
    ...(canFlushNow ? {} : { queuedDuringBusyTurn: true }),
    attachments: msg.attachments,
    queuedAt: Date.now(),
  });
  emitQueueUpdate(receiverId, managed);
  if (canFlushNow) {
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

export function enqueueUserMessage(agentId: string, managed: ManagedAgent, text: string, username: string | undefined, attachments: Attachment[] | undefined): boolean {
  if (managed.messageQueue.length >= QUEUE_MAX) return false;
  // This path is only reached when the agent is mid-turn (see sendMessage's
  // isAgentBusy gate), so the queued item by definition predates the agent's
  // most recent reply.
  const item: QueuedMessage = {
    id: generateQueuedId(managed.messageQueue),
    sender: { kind: "user", username },
    text,
    queuedDuringBusyTurn: true,
    attachments,
    queuedAt: Date.now(),
  };
  managed.messageQueue.push(item);
  emitQueueUpdate(agentId, managed);
  return true;
}

// Flush the per-agent message queue. Combines all queued items into one SDK
// send. Each item is also written as its own user_message log entry so chat
// history shows them as individual turns.
export async function flushQueue(agentId: string): Promise<void> {
  const managed = agents.get(agentId);
  if (!managed) return;
  if (managed.flushInProgress) return;
  if (managed.messageQueue.length === 0) return;
  if (isAgentBusy(managed.info.state)) return;
  if (managed.pendingPermission || managed.pendingResume || managed.pendingModelPick || managed.pendingEffortPick) return;
  if (managed.abortPromise) {
    try {
      await managed.abortPromise;
    } catch {}
    if (managed.flushInProgress) return;
    if (managed.messageQueue.length === 0) return;
    if (isAgentBusy(managed.info.state)) return;
  }

  managed.flushInProgress = true;
  try {
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
    const promptParts: string[] = [];
    const unprefixedParts: string[] = [];
    const allAttachments: Attachment[] = [];
    const busyCount = items.reduce((n, m) => (m.queuedDuringBusyTurn ? n + 1 : n), 0);
    if (busyCount > 0) {
      const note =
        busyCount === 1
          ? `[Note: this message was queued while you were processing your previous turn — the sender had not seen your most recent reply when they sent it.]`
          : `[Note: these messages were queued while you were processing your previous turn — the sender had not seen your most recent reply when they sent them.]`;
      promptParts.push(note);
      unprefixedParts.push(note);
    }
    for (const m of items) {
      const body = m.sdkText ?? m.text;
      promptParts.push(`${senderPrefixText(m.sender)}${body}`);
      unprefixedParts.push(body);
      if (m.attachments) allAttachments.push(...m.attachments);
    }
    const prompt = promptParts.join("\n\n");
    const originalText = unprefixedParts.join("\n\n");
    const firstUserSender = items.find((m) => m.sender.kind === "user");
    const flushUsername = firstUserSender && firstUserSender.sender.kind === "user" ? (firstUserSender.sender.username ?? null) : null;

    try {
      await runAgentTurn({
        managed,
        visibleText: prompt,
        originalText,
        sdkText: prompt,
        username: flushUsername,
        attachments: allAttachments.length > 0 ? allAttachments : undefined,
        origin: "queued",
        humanInput: items.some((m) => m.sender.kind === "user"),
        onSendAccepted: () => {
          for (const m of items) {
            const base = senderMeta(m.sender);
            const meta = m.sdkText ? { ...(base ?? {}), sdkText: m.sdkText } : base;
            addLogEntry(agentId, "user_message", m.text, meta, m.attachments);
          }
        },
      });
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
