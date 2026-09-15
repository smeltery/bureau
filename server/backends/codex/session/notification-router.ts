import type { JsonRpcNotification } from "../client.ts";
import { attachmentFromPath } from "../session-attachments.ts";
import { handleCodexNotification } from "../session-notifications.ts";

// Internal splitter for session.ts's LOC budget. It operates on the CodexSession
// instance so the callback adapter stays in one place.
export function routeCodexNotification(session: any, n: JsonRpcNotification): void {
  handleCodexNotification(n, {
    threadId: session.threadId,
    childThreads: session.childThreads,
    turnInFlight: session.turnInFlight,
    turnStarting: session.turnStarting,
    lateToolResultNoticeArmed: session.lateToolResultNoticeArmed,
    lateToolResultNoticeEmitted: session.lateToolResultNoticeEmitted,
    selfInterruptedForAuth: session.authGate.selfInterruptedForAuth,
    authSignalEmittedThisTurn: session.authGate.authSignalEmittedThisTurn,
    usage: session.usage,
    rateLimits: session.rateLimits,
    setActiveTurnId: (turnId) => {
      session.activeTurnId = turnId;
    },
    clearTurnInFlight: () => {
      session.turnInFlight = false;
    },
    armLateToolResultNotice: () => {
      session.lateToolResultNoticeArmed = true;
    },
    markLateToolResultNoticeEmitted: () => {
      session.lateToolResultNoticeEmitted = true;
    },
    resetAuthTurnState: () => {
      session.authGate.resetTurn();
    },
    enqueue: (event) => session.enqueue(event),
    enqueueAuthAwareSystemText: (text) => session.enqueueAuthAwareSystemText(text),
    attachmentFromPath: (rawPath) => attachmentFromPath(session.opts.agentId, rawPath),
    capacityErrorThisAttempt: () => session.capacityRetry.errorThisAttempt,
    completedItemsThisAttempt: () => session.capacityRetry.completedItemsThisAttempt,
    capacityRetryCount: () => session.capacityRetry.retryCount,
    retryCapacityTurn: (delayMs) => session.retryCapacityTurn(delayMs),
    noteCompletedItemForCapacity: () => {
      session.capacityRetry.completedItemsThisAttempt += 1;
    },
    noteCapacityError: (message) => {
      session.capacityRetry.errorThisAttempt = message;
    },
    clearCapacityRetry: () => session.capacityRetry.resetTurn(),
  });
}
