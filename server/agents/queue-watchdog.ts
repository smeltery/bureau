import { errMessage } from "../../shared/errors.ts";
import { addLogEntry, agents, logCache, type ManagedAgent } from "./state.ts";
import { createSession, replaceSession } from "./session/runtime.ts";

export const BUSY_TURN_WATCHDOG_SWEEP_MS = 30_000;
export const BUSY_TURN_WATCHDOG_STUCK_MS = 10 * 60_000;
export const FORCED_RECOVERY_COOLDOWN_MS = 5 * 60_000;

let busyTurnWatchdogStuckMs = BUSY_TURN_WATCHDOG_STUCK_MS;
const lastForcedRecoveryAt = new Map<string, number>();

export function oldestActiveTool(managed: ManagedAgent): { name: string; startedAt: number } | null {
  let oldest: { name: string; startedAt: number } | null = null;
  for (const tool of managed.toolCallTimestamps.values()) {
    if (!oldest || tool.startedAt < oldest.startedAt) oldest = tool;
  }
  return oldest;
}

export function turnIsLive(managed: ManagedAgent): boolean {
  return managed.turnStartedAt > 0 && (managed.info.state === "thinking" || managed.info.state === "tool_executing");
}

function inMultiStepFlow(managed: ManagedAgent): boolean {
  return !!managed.pendingPermission || (managed.queuedPermissions?.length ?? 0) > 0 || managed.pendingResume || managed.pendingModelPick || managed.pendingEffortPick || managed.pendingCronjobPick;
}

function lastRecoveryAt(agentId: string): number {
  return lastForcedRecoveryAt.get(agentId) ?? 0;
}

export async function sweepBusyTurnWatchdog(now = Date.now()): Promise<number> {
  let acted = 0;
  for (const [agentId, managed] of [...agents.entries()]) {
    if (agents.get(agentId) !== managed) continue;
    if (managed.messageQueue.length === 0) continue;
    if (!turnIsLive(managed)) continue;
    if (oldestActiveTool(managed) !== null) continue;
    if (managed.pendingTurn === null) continue;
    if (inMultiStepFlow(managed)) continue;
    if (managed.info.sessionSwapping) continue;
    if (managed.aborting || managed.abortPromise) continue;

    const quiescenceStartedAt = managed.lastNormalizedEventAt || managed.turnStartedAt;
    if (quiescenceStartedAt <= 0 || now - quiescenceStartedAt < busyTurnWatchdogStuckMs) continue;

    const tailKind = (logCache.get(agentId) ?? []).at(-1)?.kind ?? "none";
    if (managed.info.state === "thinking" || managed.info.agentType !== "claude") {
      if (!managed.busyTurnWatchdogObserved) {
        managed.busyTurnWatchdogObserved = true;
        const reason = managed.info.state === "thinking" ? "thinking state" : "non-Claude backend";
        console.warn(
          `[queue-watchdog] would-act ${managed.info.name} (${agentId}): ${reason} quiescent for ${now - quiescenceStartedAt}ms with ${managed.messageQueue.length} queued message(s), no active tool, tail=${tailKind}; observing without recovery`,
        );
      }
      continue;
    }

    if (now - lastRecoveryAt(agentId) < FORCED_RECOVERY_COOLDOWN_MS) continue;
    lastForcedRecoveryAt.set(agentId, now);
    console.error(
      `[queue-watchdog] ${managed.info.name} (${agentId}): Claude turn quiescent for ${now - quiescenceStartedAt}ms with ${managed.messageQueue.length} queued message(s), no active tool, tail=${tailKind}; forcing recovery via session replacement`,
    );
    addLogEntry(agentId, "system", "Message delivery stalled; recovering.");
    try {
      const sessionId = managed.sessionId;
      await replaceSession(agentId, managed, sessionId ? createSession(managed, sessionId) : createSession(managed));
      acted++;
    } catch (err) {
      console.error(`[queue-watchdog] busy-turn recovery failed for ${agentId}:`, errMessage(err));
    }
  }
  return acted;
}

let watchdogSweep: ReturnType<typeof setInterval> | null = null;

export function startBusyTurnWatchdog() {
  if (watchdogSweep) return;
  watchdogSweep = setInterval(() => {
    sweepBusyTurnWatchdog().catch((err) => {
      console.error("[queue-watchdog] sweep failed:", errMessage(err));
    });
  }, BUSY_TURN_WATCHDOG_SWEEP_MS);
}

export function _testSetBusyTurnWatchdogStuckMs(ms: number): number {
  const prev = busyTurnWatchdogStuckMs;
  busyTurnWatchdogStuckMs = ms;
  return prev;
}

export function _testLastForcedRecoveryAt(agentId: string): number {
  return lastRecoveryAt(agentId);
}
