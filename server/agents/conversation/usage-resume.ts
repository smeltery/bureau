import { logMessage } from "../../../shared/i18n/log-message.ts";
import { agents, emit, emitQueueUpdate, addLogEntry, persistAll, type ManagedAgent } from "../state.ts";
import { inMultiStepFlow } from "../pending-prompt.ts";
import { enqueueMessage } from "./message-queue.ts";

export interface UsageResumeClock {
  now(): number;
  schedule(run: () => void, delay: number): () => void;
}
const clock: UsageResumeClock = {
  now: Date.now,
  schedule(run, delay) {
    const timer = setTimeout(run, delay);
    timer.unref();
    return () => clearTimeout(timer);
  },
};
const timers = new Map<string, () => void>();
const DAY = 86_400_000;

function enabled(managed: ManagedAgent): boolean {
  return managed.info.resumeAfterUsageLimit !== false && (managed.info.agentType === "claude" || managed.info.agentType === "codex");
}

export function cancelUsageResume(managed: ManagedAgent): void {
  const id = managed.info.id;
  timers.get(id)?.();
  timers.delete(id);
  const hadPlan = !!managed.usageResumePlan;
  managed.usageResumePlan = undefined;
  managed.info.usageResumeAt = undefined;
  const queueLength = managed.messageQueue.length;
  managed.messageQueue = managed.messageQueue.filter((message) => !message.usageResume);
  const queueChanged = queueLength !== managed.messageQueue.length;
  if (!hadPlan && !queueChanged) return;
  if (queueChanged) emitQueueUpdate(id, managed);
  emit({ type: "agent_updated", agentId: id, changes: { usageResumeAt: null } });
  if (agents.get(id) === managed) persistAll();
}

function schedule(managed: ManagedAgent, timing: UsageResumeClock, minimumDelay = 0): void {
  const plan = managed.usageResumePlan;
  if (!plan) return;
  const id = managed.info.id;
  timers.get(id)?.();
  timers.set(
    id,
    timing.schedule(
      () => {
        if (agents.get(id) !== managed || managed.usageResumePlan !== plan) return;
        if (timing.now() < plan.dueAt) return schedule(managed, timing);
        try {
          cancelUsageResume(managed);
          if (
            !enabled(managed) ||
            managed.sessionId !== plan.sessionId ||
            managed.aborting ||
            managed.pendingTurn ||
            managed.info.sessionSwapping ||
            managed.flushHeld ||
            managed.flushInProgress ||
            managed.autoHandoffAttempt ||
            inMultiStepFlow(managed)
          )
            return;
          if (managed.info.state !== "idle" && managed.info.state !== "waiting_for_response") return;
          if (managed.providerSignInBlockedSession) return;
          const result = enqueueMessage(id, {
            sender: { kind: "agent", agentId: id, agentName: managed.info.name, roomName: "" },
            text: "[Bureau: the provider usage window has reset. Continue the task where it stopped.]",
            usageResume: true,
          });
          if (!result.ok) addLogEntry(id, "system", logMessage("logs.session.continuationRejected", { error: result.error }));
        } catch (error) {
          console.error("[usage-resume] continuation failed:", id, error);
        }
      },
      Math.min(DAY, Math.max(minimumDelay, plan.dueAt - timing.now())),
    ),
  );
}

export function armUsageResume(managed: ManagedAgent, resetsAt: number, timing = clock): void {
  if (
    !enabled(managed) ||
    !managed.sessionId ||
    !Number.isSafeInteger(resetsAt) ||
    resetsAt <= timing.now() ||
    !Number.isSafeInteger(resetsAt + 60_000) ||
    !Number.isFinite(new Date(resetsAt + 60_000).getTime())
  )
    return;
  managed.usageResumePlan = { sessionId: managed.sessionId, dueAt: resetsAt + 60_000 };
  managed.info.usageResumeAt = managed.usageResumePlan.dueAt;
  persistAll();
  emit({ type: "agent_updated", agentId: managed.info.id, changes: { usageResumeAt: managed.info.usageResumeAt } });
  addLogEntry(managed.info.id, "system", logMessage("logs.session.usageResume", { date: { timestamp: managed.usageResumePlan.dueAt, style: "full" } }));
  schedule(managed, timing);
}

export function restoreUsageResume(managed: ManagedAgent, plan: ManagedAgent["usageResumePlan"], timing = clock): void {
  if (!plan || !enabled(managed) || plan.sessionId !== managed.sessionId || !Number.isSafeInteger(plan.dueAt) || plan.dueAt <= 0 || !Number.isFinite(new Date(plan.dueAt).getTime())) return;
  managed.usageResumePlan = plan;
  managed.info.usageResumeAt = plan.dueAt;
  schedule(managed, timing, 30_000);
}
