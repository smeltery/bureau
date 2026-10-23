import type { QueuedMessage } from "../../../shared/types.ts";
import type { BackendSession } from "../../backends/types.ts";
import { addLogEntry, agents, emitQueueUpdate, persistAll, type ManagedAgent } from "../state.ts";
import { flushPrefix, senderMeta } from "./queue-prefix.ts";

const TOOL_BOUNDARY_NOTE = "[Bureau: delivered between your tool calls; nothing was interrupted.]";
const NO_CLAIM: ReadonlySet<QueuedMessage> = new Set();

export function boundaryEligible(m: Pick<QueuedMessage, "sender" | "sdkText" | "handoff" | "attachments" | "usageResume">): boolean {
  return m.sender.kind !== "user" && !m.sdkText && !m.handoff && !m.usageResume && !m.attachments?.length;
}

function liveClaimed(managed: ManagedAgent): ReadonlySet<QueuedMessage> {
  const claim = managed.boundaryClaim;
  if (!claim) return NO_CLAIM;
  if (claim.session !== managed.session) {
    managed.boundaryClaim = null;
    return NO_CLAIM;
  }
  return claim.items;
}

function hasPendingFlow(managed: ManagedAgent): boolean {
  return !!(managed.pendingPermission || (managed.queuedPermissions?.length ?? 0) > 0 || managed.pendingResume || managed.pendingModelPick || managed.pendingEffortPick || managed.pendingCronjobPick);
}

export function unclaimedQueue(managed: ManagedAgent): QueuedMessage[] {
  const claimed = liveClaimed(managed);
  return claimed.size === 0 ? [...managed.messageQueue] : managed.messageQueue.filter((item) => !claimed.has(item));
}

export function takeToolBoundaryMessage(agentId: string, session: BackendSession | null): string | null {
  const managed = agents.get(agentId);
  if (!managed || managed.autoHandoffAttempt || managed.session !== session || managed.flushInProgress || hasPendingFlow(managed)) return null;
  const items = unclaimedQueue(managed);
  if (!items.some((m) => m.steer) || !items.every(boundaryEligible)) return null;
  const claim = managed.boundaryClaim?.session === session ? managed.boundaryClaim : { session, items: new Set<QueuedMessage>() };
  const parts = [TOOL_BOUNDARY_NOTE, ...items.map((m) => `${flushPrefix(m, agentId)}${m.text}`)];
  for (const item of items) claim.items.add(item);
  managed.boundaryClaim = claim;
  for (const m of items) {
    addLogEntry(agentId, "user_message", m.text, { ...(senderMeta(m.sender) ?? {}), delivery: "tool_boundary" }, m.attachments);
  }
  emitQueueUpdate(agentId, managed);
  persistAll();
  return parts.join("\n\n");
}

export function drainToolBoundaryClaim(agentId: string, managed: ManagedAgent): void {
  const claimed = new Set(liveClaimed(managed));
  if (claimed.size === 0) {
    managed.boundaryClaim = null;
    return;
  }
  for (const items of managed.boundaryClaim?.pending?.values() ?? []) for (const item of items) claimed.delete(item);
  const sentIds = new Set([...claimed].map((item) => item.id));
  managed.messageQueue = managed.messageQueue.filter((item) => !sentIds.has(item.id));
  managed.boundaryClaim = null;
  emitQueueUpdate(agentId, managed);
  persistAll();
}
