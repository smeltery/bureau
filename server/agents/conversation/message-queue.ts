import type { AgentState, Attachment, QueuedMessage, QueuedSender } from "../../../shared/types.ts";
import { formatAgentSenderPrefix, formatAppSenderPrefix, formatUserPrefix } from "../../../shared/identity.ts";
import { addLogEntry, agents, emitQueueUpdate, isAgentBusy, logCache, persistAll, updateState, type ManagedAgent } from "../state.ts";
import { SessionSwappedError, createSession, installSession } from "../session/runtime.ts";
import { armDormantWakeNotice } from "../session/wake-notice.ts";
import { runAgentTurn } from "../../plugins/run-agent-turn.ts";
// Circular with control.ts (which imports flushQueue from here); safe because
// both modules only call across the cycle at request time, never at load time.
import { sendNow } from "./control.ts";

export const QUEUE_MAX = 50;

// Agent-initiated steering: how many times other agents may interrupt one
// receiver's turns within a rolling window before further steers degrade to a
// plain queue. Three per minute leaves room for a correction and a follow-up
// while stopping a pair of agents from steering each other in a loop, where
// every abort throws away in-flight work. The message is still accepted either
// way, so the limit only ever delays it to the receiver's next turn boundary.
const STEER_RATE_LIMIT = 3;
const STEER_RATE_WINDOW_MS = 60_000;

// Why a requested steer did not interrupt the receiver. Both reasons degrade
// to a plain queue rather than failing the send: the message is always
// accepted, only the interruption is refused.
//   multi_step_flow — the receiver is part-way through a permission / resume /
//     model / effort pick, where the next message is read as the pick.
//     Aborting there would kill a turn and still not deliver (flushQueue
//     declines to run in a multi-step flow).
//   rate_limited — too many interruptions of this receiver in the recent
//     window; letting them through would keep it from ever finishing a turn.
export type SteerDeclineReason = "multi_step_flow" | "rate_limited";

function generateQueuedId(existing: QueuedMessage[]): string {
  // 6-char hex; retry on collision (extremely unlikely with a Map<= QUEUE_MAX)
  for (let i = 0; i < 8; i++) {
    const id = Math.random().toString(16).slice(2, 8);
    if (!existing.some((m) => m.id === id)) return id;
  }
  return `${Date.now().toString(16).slice(-6)}`;
}

// Single entry point for both human (textarea via sendMessage) and agent
// (HTTP POST /api/agents/:id/messages) senders. Decides whether to queue or
// flush-immediately based on the receiver's state. Rejects `error` /
// `stopped` agents with 409. The textarea path (sendMessage) is more
// permissive; it has its own session-recovery branch, but agents benefit from
// an explicit failure so they can retry or fall back.
// `steered` / `steerDeclined` are present only when the caller asked to steer
// (and never on a deduped retry, which interrupted nobody).
export type EnqueueResult = { ok: true; queued: boolean; messageId: string; steered?: boolean; steerDeclined?: SteerDeclineReason } | { ok: false; error: string; status: number };

// Steer rate limit. Prunes the receiver's window in place and reports whether
// another interruption fits. Called only on the path that is about to
// interrupt, so the pruning cost is bounded by the limit itself.
function steerRateLimited(managed: ManagedAgent): boolean {
  const cutoff = Date.now() - STEER_RATE_WINDOW_MS;
  managed.recentSteers = managed.recentSteers.filter((t) => t > cutoff);
  return managed.recentSteers.length >= STEER_RATE_LIMIT;
}

export function enqueueMessage(
  receiverId: string,
  msg: { sender: QueuedSender; text: string; clientMessageId?: string; sdkText?: string; attachments?: Attachment[]; scheduledFor?: number; scheduledSenderGone?: boolean },
  // Agent-initiated steering. Set by the inter-agent send routes when the
  // sender passed "steer":true. Deliberately an option on THIS call rather
  // than a second request: the decision uses the same state read that picks
  // flush-vs-queue below, in the same synchronous block as the queue push, so
  // the receiver cannot go idle (and swallow the message into an ordinary
  // flush) between the enqueue and the interrupt.
  opts?: { steer?: boolean },
): EnqueueResult {
  const managed = agents.get(receiverId);
  if (!managed) return { ok: false, error: "agent not found", status: 404 };
  const state = managed.info.state;
  if (state === "error" || state === "stopped") {
    return { ok: false, error: "agent is not accepting messages", status: 409 };
  }
  if (msg.clientMessageId) {
    const duplicate = managed.messageQueue.find((item) => item.clientMessageId === msg.clientMessageId && sameSender(item.sender, msg.sender));
    // The duplicate is still sitting in the queue, so queued:true stays
    // truthful. No steer fields: this retry interrupted nobody.
    if (duplicate) return { ok: true, queued: true, messageId: duplicate.id };
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
    ...(msg.clientMessageId ? { clientMessageId: msg.clientMessageId } : {}),
    ...(msg.sdkText ? { sdkText: msg.sdkText } : {}),
    ...(canFlushNow ? {} : { queuedDuringBusyTurn: true }),
    ...(msg.scheduledFor ? { scheduledFor: msg.scheduledFor } : {}),
    ...(msg.scheduledSenderGone ? { scheduledSenderGone: true } : {}),
    attachments: msg.attachments,
    queuedAt: Date.now(),
  });
  emitQueueUpdate(receiverId, managed);
  persistAll();
  const steerRequested = opts?.steer === true;
  if (canFlushNow) {
    flushQueue(receiverId).catch((err: any) => {
      console.error(`flushQueue (post-enqueue) failed for ${receiverId}:`, err.message);
    });
    // A steer at a receiver that wasn't running a turn interrupts nothing —
    // reported as steered:false rather than declined, since no guard rail
    // refused it and the message is being delivered now either way.
    return { ok: true, queued: false, messageId: id, ...(steerRequested ? { steered: false } : {}) };
  }
  if (steerRequested) {
    // Guard rails, in refusal order. Both leave the message queued (the sender
    // is told which one fired) rather than failing the send. Multi-step first:
    // aborting an agent that is answering a pick would end its turn and still
    // not deliver, since flushQueue declines to run there.
    if (managed.pendingPermission || managed.pendingResume || managed.pendingModelPick || managed.pendingEffortPick) {
      return { ok: true, queued: true, messageId: id, steered: false, steerDeclined: "multi_step_flow" };
    }
    if (steerRateLimited(managed)) {
      return { ok: true, queued: true, messageId: id, steered: false, steerDeclined: "rate_limited" };
    }
    managed.recentSteers.push(Date.now());
    // Same call the boss's "Send now" makes: abort the in-flight turn, then
    // flush. Fire-and-forget — sendNow owns its own state handling, and the
    // ack must not wait on a session replacement. The queue is non-empty (we
    // just pushed), so sendNow's empty-queue no-op cannot fire.
    sendNow(receiverId).catch((err: any) => {
      console.error(`sendNow (steer) failed for ${receiverId}:`, err.message);
    });
    // queued:false: the receiver's current turn is being cut short precisely
    // so this message does NOT wait for it, which is what queued reports.
    return { ok: true, queued: false, messageId: id, steered: true };
  }
  return { ok: true, queued: true, messageId: id };
}

function sameSender(a: QueuedSender, b: QueuedSender): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "user" && b.kind === "user") return a.username === b.username;
  if (a.kind === "agent" && b.kind === "agent") return a.agentId === b.agentId;
  return false;
}

function senderPrefixText(sender: QueuedSender): string {
  switch (sender.kind) {
    case "user":
      return formatUserPrefix(sender.username);
    case "agent":
      return `${formatAgentSenderPrefix(sender.agentId, sender.agentName, sender.roomName)} `;
    case "app":
      return `${formatAppSenderPrefix(sender.appName)} `;
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
    case "app":
      return { sender_app_name: sender.appName };
  }
}

function scheduledPrefix(m: QueuedMessage): string | null {
  if (!m.scheduledFor) return null;
  const when = new Date(m.scheduledFor).toISOString();
  const gone = m.scheduledSenderGone ? " The sender agent no longer exists." : "";
  return `[Scheduled message for ${when}.${gone}]`;
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
  persistAll();
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
  if (managed.info.state === "error" || managed.info.state === "stopped") return;
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
    const pending = managed.pendingTurn;
    if (pending) {
      await pending.promise.catch(() => {});
      if (!agents.has(agentId)) return;
      if (managed.messageQueue.length === 0) return;
      if (isAgentBusy(managed.info.state)) return;
      if (managed.pendingPermission || managed.pendingResume || managed.pendingModelPick || managed.pendingEffortPick) return;
    }
    if (!managed.session) {
      const tail = (logCache.get(agentId) ?? []).at(-1);
      if (tail?.kind === "user_message") {
        addLogEntry(agentId, "system", "Previous response was interrupted.");
      }
      try {
        const sessionId = managed.sessionId;
        // Snapshot the reason before installSession clears it; arming the wake
        // note is a side effect of building the log line, and the flush below is
        // the send that carries it to the agent.
        const wakeReason = managed.dormantReason === "idle" ? "idle" : "session-ended";
        installSession(agentId, managed, sessionId ? createSession(managed, sessionId) : createSession(managed));
        addLogEntry(agentId, "system", sessionId ? armDormantWakeNotice(managed, wakeReason, sessionId) : "Started a fresh session before flushing queued messages.");
      } catch (err: any) {
        addLogEntry(agentId, "error", `Cannot start session to flush queue: ${err.message}`);
        updateState(agentId, "error");
        return;
      }
    }
    const items = managed.messageQueue.slice();
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
      const scheduleNote = scheduledPrefix(m);
      promptParts.push(`${scheduleNote ? `${scheduleNote}\n` : ""}${senderPrefixText(m.sender)}${body}`);
      unprefixedParts.push(scheduleNote ? `${scheduleNote}\n${body}` : body);
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
          const sentIds = new Set(items.map((m) => m.id));
          managed.messageQueue = managed.messageQueue.filter((m) => !sentIds.has(m.id));
          emitQueueUpdate(agentId, managed);
          persistAll();
          for (const m of items) {
            const base = senderMeta(m.sender);
            const withSchedule = m.scheduledFor ? { ...(base ?? {}), scheduledFor: m.scheduledFor, scheduledSenderGone: m.scheduledSenderGone ?? false } : base;
            const meta = m.sdkText ? { ...(withSchedule ?? {}), sdkText: m.sdkText } : withSchedule;
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
    const stateAfterFlush = managed.info.state as AgentState;
    if (
      managed.messageQueue.length > 0 &&
      stateAfterFlush !== "error" &&
      stateAfterFlush !== "stopped" &&
      !isAgentBusy(stateAfterFlush) &&
      !managed.pendingPermission &&
      !managed.pendingResume &&
      !managed.pendingModelPick &&
      !managed.pendingEffortPick
    ) {
      flushQueue(agentId).catch((err: any) => {
        console.error(`flushQueue (post-flush retry) failed for ${agentId}:`, err.message);
      });
    }
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
  persistAll();
  return true;
}
