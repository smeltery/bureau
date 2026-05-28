import type { Attachment, QueuedMessage, QueuedSender } from "../../../shared/types.ts";
import { MODEL_FAMILIES, familyDisplayLabel } from "../../../shared/types.ts";
import { formatAgentSenderPrefix, formatUserPrefix } from "../../../shared/identity.ts";
import { loadLogWithAncestors } from "../../persistence.ts";
import { addLogEntry, agents, emit, emitEphemeralLog, emitQueueUpdate, isAgentBusy, logCache, persistAll, updateState, type ManagedAgent } from "../state.ts";
import { SessionSwappedError, createSession, installSession, replaceSession } from "../session/runtime.ts";
import { runAgentTurn } from "../../plugins/run-agent-turn.ts";
import { generateTopic, persistCurrentSessionTopic, shouldAutoRegenerateTopic, TOPIC_REGEN_THRESHOLD } from "../topic.ts";
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
  const canFlushNow = !isAgentBusy(state) && !managed.pendingPermission && !managed.pendingResume && !managed.pendingModelPick;
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
  // Receiver is idle: flush right away so the message lands without a
  // user gesture. flushQueue is safe to call here — it re-checks state.
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

function enqueueUserMessage(agentId: string, managed: ManagedAgent, text: string, username: string | undefined, attachments: Attachment[] | undefined): boolean {
  if (managed.messageQueue.length >= QUEUE_MAX) return false;
  // This path is only reached when the agent is mid-turn (see sendMessage's
  // isAgentBusy gate), so the queued item by definition predates the
  // agent's most recent reply.
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
    // unprefixedParts mirrors promptParts but without the sender prefix per
    // item. Plugins receive the joined unprefixed version as `originalText`
    // so memory/audit see user intent without `[Nil]` noise that belongs
    // to bureau's routing layer rather than the user's message.
    const unprefixedParts: string[] = [];
    const allAttachments: Attachment[] = [];
    // If any items were queued while the agent was busy, prepend a single
    // coalesced note so the agent doesn't read them as reactions to its
    // most recent reply (the sender hadn't seen that reply yet).
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
      // sdkText is set for pre-expanded slash commands (e.g. an
      // /bureau-peer-review queued while the agent was mid-turn): chat
      // shows m.text "/bureau-peer-review", but the SDK needs the full
      // skill prompt.
      const body = m.sdkText ?? m.text;
      promptParts.push(`${senderPrefixText(m.sender)}${body}`);
      unprefixedParts.push(body);
      if (m.attachments) allAttachments.push(...m.attachments);
    }
    const prompt = promptParts.join("\n\n");
    const originalText = unprefixedParts.join("\n\n");
    // Username attribution: pick the first user sender's username (if any)
    // for plugin context. Mixed user/agent flushes still surface the human
    // boss as the attribution target; pure agent-to-agent flushes pass null.
    const firstUserSender = items.find((m) => m.sender.kind === "user");
    const flushUsername = firstUserSender && firstUserSender.sender.kind === "user" ? (firstUserSender.sender.username ?? null) : null;

    try {
      await runAgentTurn({
        managed,
        // No single "user-typed" string for a coalesced flush; the prompt
        // composition is the closest approximation, and plugins generally
        // use originalText (sender prefixes stripped) anyway.
        visibleText: prompt,
        originalText,
        sdkText: prompt,
        username: flushUsername,
        attachments: allAttachments.length > 0 ? allAttachments : undefined,
        origin: "queued",
        humanInput: items.some((m) => m.sender.kind === "user"),
        onSendAccepted: () => {
          // Send accepted by the backend. Finalize: write per-message log
          // entries (provenance). Runs synchronously inside runAgentTurn
          // between session.send resolving and the newLogEntries snapshot,
          // so these user_messages stay OUT of the afterTurn slice (they
          // belong to "the prompt", not "the agent's response").
          for (const m of items) {
            // Carry sdkText into the log metadata so editMessage can match
            // this entry against the SDK session (the SDK saw the expanded
            // prompt, not m.text). Same shape executeSkill uses on the
            // immediate path.
            const base = senderMeta(m.sender);
            const meta = m.sdkText ? { ...(base ?? {}), sdkText: m.sdkText } : base;
            addLogEntry(agentId, "user_message", m.text, meta, m.attachments);
          }
        },
      });
    } catch (err: any) {
      // runAgentTurn re-throws whatever the underlying turn threw and has
      // already cleaned up the pendingTurn deferred if session.send fell
      // before await turn. Per-site error semantics remain here.
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
      installSession(agentId, managed, sessionId ? createSession(managed, sessionId) : createSession(managed));
      addLogEntry(agentId, "system", sessionId ? "Resumed prior session after the previous one ended unexpectedly." : "Started a fresh session (previous one could not be restored).");
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
    const trimmed = text.trim();
    if (trimmed === "1") {
      emitEphemeralLog(agentId, "system", "Permission granted (rule added for this session).");
      await managed.session?.approve(pending.approvalId, { kind: "allow_persistent" });
    } else if (trimmed === "2") {
      emitEphemeralLog(agentId, "system", "Permission granted (once).");
      await managed.session?.approve(pending.approvalId, { kind: "allow_once" });
    } else if (trimmed === "3") {
      emitEphemeralLog(agentId, "system", "Permission denied.");
      await managed.session?.approve(pending.approvalId, { kind: "deny", reason: "User denied." });
    } else {
      emitEphemeralLog(agentId, "system", "Permission denied with reason forwarded to agent.");
      await managed.session?.approve(pending.approvalId, { kind: "deny", reason: text });
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
        // Restore the textCount baseline from sessions.json so drift is
        // measured against the replayed history, not from zero (otherwise
        // any first new message after resume trivially trips the threshold).
        managed.topicMessageCount = picked.topicMessageCount;
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
        // Restore topic; topicStale reflects whether the replayed history has
        // moved past the topic's generation point.
        const replayedTextCount = history.filter((e) => e.kind === "user_message" || e.kind === "text").length;
        const drift = replayedTextCount - picked.topicMessageCount;
        managed.info.topic = picked.topic;
        managed.info.topicStale = drift > 0;
        emit({ type: "agent_updated", agentId, changes: { topic: picked.topic, topicStale: drift > 0 } });
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
  if (isSlash) {
    const [cmd, ...args] = text.slice(1).trim().split(/\s+/);
    const handled = await handleSlashCommand(agentId, managed, cmd, args, text, username);
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
