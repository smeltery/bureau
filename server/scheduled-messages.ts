import type { QueuedSender, ScheduledMessageEntry } from "../shared/types.ts";
import { loadScheduledMessages, saveScheduledMessages } from "./persistence.ts";
import * as AgentManager from "./agent-manager.ts";

const TICK_INTERVAL_MS = 30_000;
const INITIAL_TICK_DELAY_MS = 5_000;
const MAX_PENDING_PER_SENDER = 20;
const MAX_HORIZON_MS = 30 * 24 * 60 * 60 * 1000;
const DELIVERY_DEADLINE_MS = 24 * 60 * 60 * 1000;
const RFC3339_RE = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:[Zz]|[+-]\d{2}:\d{2})$/;

let entries: ScheduledMessageEntry[] = [];
let loaded = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let initialHandle: ReturnType<typeof setTimeout> | null = null;
let tickInProgress = false;

export type ScheduleMessageResult = { ok: true; entry: ScheduledMessageEntry; deduped: boolean } | { ok: false; status: number; error: string };

export function parseDeliverAt(value: string): number | null {
  if (!RFC3339_RE.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function ensureLoaded() {
  if (loaded) return;
  entries = loadScheduledMessages();
  loaded = true;
}

function persist(next: ScheduledMessageEntry[]) {
  saveScheduledMessages(next);
  entries = next;
}

function scheduledId(): string {
  const ids = new Set(entries.map((entry) => entry.id));
  for (;;) {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    const id = `sm_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    if (!ids.has(id)) return id;
  }
}

export function scheduleAgentMessage(input: { senderAgentId: string; receiverAgentId: string; text: string; deliverAt: number; clientMessageId?: string }): ScheduleMessageResult {
  ensureLoaded();
  const now = Date.now();
  if (!input.text) return { ok: false, status: 400, error: "text is required" };
  if (input.deliverAt <= now) return { ok: false, status: 400, error: "deliverAt must be in the future" };
  if (input.deliverAt - now > MAX_HORIZON_MS) return { ok: false, status: 400, error: "deliverAt is more than 30 days ahead" };
  const sender = AgentManager.getAgentDisplay(input.senderAgentId);
  if (!sender) return { ok: false, status: 400, error: "sender agent is not known" };
  if (!AgentManager.getAgentDisplay(input.receiverAgentId)) return { ok: false, status: 404, error: "recipient agent not found" };
  if (input.clientMessageId) {
    const existing = entries.find((entry) => entry.senderAgentId === input.senderAgentId && entry.clientMessageId === input.clientMessageId);
    if (existing) {
      if (existing.receiverAgentId === input.receiverAgentId && existing.text === input.text && existing.deliverAt === input.deliverAt) {
        return { ok: true, entry: existing, deduped: true };
      }
      return { ok: false, status: 409, error: "clientMessageId already used for a different scheduled message" };
    }
  }
  const pendingCount = entries.filter((entry) => entry.senderAgentId === input.senderAgentId).length;
  if (pendingCount >= MAX_PENDING_PER_SENDER) return { ok: false, status: 429, error: `too many pending scheduled messages (limit ${MAX_PENDING_PER_SENDER})` };
  const entry: ScheduledMessageEntry = {
    id: scheduledId(),
    senderAgentId: input.senderAgentId,
    senderName: sender.name,
    senderRoomName: sender.roomName,
    receiverAgentId: input.receiverAgentId,
    text: input.text,
    ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
    deliverAt: input.deliverAt,
    createdAt: now,
  };
  try {
    persist([...entries, entry]);
    return { ok: true, entry, deduped: false };
  } catch (err) {
    console.error("[scheduled-messages] failed to save scheduled message:", err);
    return { ok: false, status: 500, error: "failed to persist scheduled message" };
  }
}

export function listScheduledMessages(senderAgentId: string): ScheduledMessageEntry[] {
  ensureLoaded();
  return entries.filter((entry) => entry.senderAgentId === senderAgentId).sort((a, b) => a.deliverAt - b.deliverAt || a.createdAt - b.createdAt);
}

export function cancelScheduledMessage(senderAgentId: string, scheduledId: string): boolean {
  ensureLoaded();
  const next = entries.filter((entry) => !(entry.senderAgentId === senderAgentId && entry.id === scheduledId));
  if (next.length === entries.length) return false;
  persist(next);
  return true;
}

export function tickScheduledMessages(now = Date.now()) {
  ensureLoaded();
  if (tickInProgress) return;
  tickInProgress = true;
  try {
    const due = entries.filter((entry) => entry.deliverAt <= now).sort((a, b) => a.deliverAt - b.deliverAt || a.createdAt - b.createdAt);
    const blockedReceivers = new Set<string>();
    const delivered = new Set<string>();
    for (const entry of due) {
      if (blockedReceivers.has(entry.receiverAgentId)) continue;
      const liveSender = AgentManager.getAgentDisplay(entry.senderAgentId);
      const sender: Extract<QueuedSender, { kind: "agent" }> = {
        kind: "agent",
        agentId: entry.senderAgentId,
        agentName: liveSender?.name ?? entry.senderName,
        roomName: liveSender?.roomName ?? entry.senderRoomName,
      };
      const result = AgentManager.enqueueMessage(entry.receiverAgentId, {
        sender,
        text: entry.text,
        scheduledFor: entry.deliverAt,
        scheduledSenderGone: !liveSender,
      });
      if (result.ok) {
        delivered.add(entry.id);
        continue;
      }
      if (result.status === 404 || now - entry.deliverAt > DELIVERY_DEADLINE_MS) {
        delivered.add(entry.id);
        console.warn(`[scheduled-messages] dropped ${entry.id}: ${result.error}`);
      } else {
        blockedReceivers.add(entry.receiverAgentId);
      }
    }
    if (delivered.size > 0) persist(entries.filter((entry) => !delivered.has(entry.id)));
  } finally {
    tickInProgress = false;
  }
}

export function startScheduledMessageScheduler() {
  ensureLoaded();
  if (intervalHandle) return;
  initialHandle = setTimeout(() => tickScheduledMessages(), INITIAL_TICK_DELAY_MS);
  intervalHandle = setInterval(() => tickScheduledMessages(), TICK_INTERVAL_MS);
}

export function stopScheduledMessageScheduler() {
  if (initialHandle) clearTimeout(initialHandle);
  if (intervalHandle) clearInterval(intervalHandle);
  initialHandle = null;
  intervalHandle = null;
}
