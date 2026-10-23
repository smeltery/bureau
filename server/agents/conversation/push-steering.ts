import type { QueuedMessage } from "../../../shared/types.ts";
import { agents, addLogEntry, emitQueueUpdate, persistAll, isAgentBusy, type ManagedAgent } from "../state.ts";
import { boundaryEligible, unclaimedQueue } from "./boundary-delivery.ts";
import { flushPrefix, senderMeta } from "./queue-prefix.ts";

type Claim = NonNullable<ManagedAgent["boundaryClaim"]>;

function release(agentId: string, managed: ManagedAgent, claim: Claim, id: string) {
  const items = claim.pending?.get(id);
  if (!items || managed.boundaryClaim !== claim || agents.get(agentId) !== managed) return;
  claim.pending!.delete(id);
  for (const item of items) claim.items.delete(item);
  emitQueueUpdate(agentId, managed);
}

export function pushBoundarySteer(agentId: string): void {
  const managed = agents.get(agentId);
  const session = managed?.session;
  if (!managed || !session?.steer || !managed.pendingTurn || !isAgentBusy(managed.info.state)) return;
  if (
    managed.aborting ||
    managed.abortPromise ||
    managed.info.sessionSwapping ||
    managed.flushHeld ||
    managed.autoHandoffAttempt ||
    managed.usageResumePlan ||
    managed.providerSignInBlockedSession === session
  )
    return;
  if (managed.pendingPermission || managed.queuedPermissions.length || managed.pendingResume || managed.pendingModelPick || managed.pendingEffortPick || managed.pendingCronjobPick) return;
  const items = unclaimedQueue(managed);
  if (!items.some((item) => item.steer) || !items.every(boundaryEligible)) return;
  const claim: Claim = managed.boundaryClaim?.session === session ? managed.boundaryClaim : { session, items: new Set(), pending: new Map() };
  const id = `bureau-steer-${crypto.randomUUID()}`;
  const text = ["[Bureau: guidance for this turn; no running tool was interrupted.]", ...items.map((item) => `${flushPrefix(item, agentId)}${item.text}`)].join("\n\n");
  for (const item of items) claim.items.add(item);
  (claim.pending ??= new Map()).set(id, items);
  managed.boundaryClaim = claim;
  emitQueueUpdate(agentId, managed);
  // Accepted items stay on disk until a matching delivery event. An unknown
  // transport outcome stays claimed until the turn ends, never retried here.
  void (async () => {
    try {
      if (!(await session.steer!(text, id))) release(agentId, managed, claim, id);
    } catch (error) {
      console.error(`Steer outcome unknown for ${agentId}:`, error);
    }
  })();
}

export function recordSteerDelivery(agentId: string, id: string): void {
  const managed = agents.get(agentId);
  const claim = managed?.boundaryClaim;
  if (!managed || !claim || claim.session !== managed.session) return;
  const items = claim.pending?.get(id);
  if (!items) return;
  claim.pending!.delete(id);
  const queued = new Set(managed.messageQueue);
  for (const item of items) {
    claim.items.delete(item);
    if (queued.has(item)) addLogEntry(agentId, "user_message", item.text, { ...senderMeta(item.sender), delivery: "turn_steer" }, item.attachments);
  }
  const delivered = new Set<QueuedMessage>(items);
  managed.messageQueue = managed.messageQueue.filter((item) => !delivered.has(item));
  emitQueueUpdate(agentId, managed);
  persistAll();
}
