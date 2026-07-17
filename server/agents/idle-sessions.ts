import { agents } from "./state.ts";
import type { ManagedAgent } from "./state.ts";
import { waitForConsumerDrain } from "./session/runtime.ts";

export const IDLE_SESSION_EVICT_MS = 2 * 60 * 60_000;
export const IDLE_SESSION_SWEEP_MS = 5 * 60_000;

function canReleaseIdleSession(managed: ManagedAgent): boolean {
  return (
    !!managed.session &&
    !managed.abortPromise &&
    !managed.flushInProgress &&
    !managed.pendingPermission &&
    !managed.pendingResume &&
    !managed.pendingModelPick &&
    !managed.pendingEffortPick &&
    !managed.pendingTurn &&
    managed.messageQueue.length === 0 &&
    (managed.info.state === "idle" || managed.info.state === "waiting_for_response")
  );
}

export async function releaseIdleSessions(now = Date.now(), idleMs = IDLE_SESSION_EVICT_MS): Promise<number> {
  let released = 0;
  for (const [agentId, managed] of agents) {
    if (!canReleaseIdleSession(managed)) continue;
    if (now - managed.lastActivityAt < idleMs) continue;

    const session = managed.session;
    const consumer = managed.consumerPromise;
    try {
      session?.close();
    } catch {}
    managed.session = null;
    managed.consumerPromise = null;
    released++;

    if (consumer) {
      await waitForConsumerDrain(consumer);
    }

    if (agents.get(agentId) !== managed) continue;
    if (managed.session === null) {
      managed.info = { ...managed.info, state: "waiting_for_response" };
    }
  }
  return released;
}

let idleSessionSweep: ReturnType<typeof setInterval> | null = null;

export function startIdleSessionEvictor() {
  if (idleSessionSweep) return;
  idleSessionSweep = setInterval(() => {
    releaseIdleSessions().catch((err: any) => {
      console.error("[agents] idle session eviction failed:", err?.message ?? String(err));
    });
  }, IDLE_SESSION_SWEEP_MS);
}
