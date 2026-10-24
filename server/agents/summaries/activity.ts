import type { LogEntry } from "../../../shared/types.ts";
import type { ManagedAgent } from "../state-types.ts";
import { CONVERSATION_KINDS, SUMMARY_INTERVAL } from "./summary.ts";

type SummaryTarget = Pick<ManagedAgent, "sessionId" | "info">;
type RequestSummary = (managed: SummaryTarget, sessionId: string) => void;
const activity = new WeakMap<SummaryTarget, { sessionId: string; count: number }>();
let requestSummary: RequestSummary | undefined;

/** Production installs the provider runner at boot; tests can install a local fake. */
export function installSummaryRequests(request: RequestSummary): () => void {
  const previous = requestSummary;
  requestSummary = request;
  return () => {
    requestSummary = previous;
  };
}

export function recordSummaryEntry(managed: SummaryTarget, entry: LogEntry): void {
  if (!managed.sessionId || entry.ephemeral || !CONVERSATION_KINDS.has(entry.kind)) return;
  let current = activity.get(managed);
  if (current?.sessionId !== managed.sessionId) {
    current = { sessionId: managed.sessionId, count: 0 };
    activity.set(managed, current);
  }
  current.count++;
}

/** Call synchronously before changing session/account fields so the runner can capture them. */
export function requestSessionSummary(managed: SummaryTarget, ended = false): void {
  const sessionId = managed.sessionId;
  const current = activity.get(managed);
  if (!sessionId || (!ended && (current?.sessionId !== sessionId || current.count < SUMMARY_INTERVAL))) return;
  activity.delete(managed);
  if (!requestSummary) return;
  try {
    requestSummary(managed, sessionId);
  } catch {
    // A metadata failure must not prevent a turn finishing or a session switching.
    console.error("Could not request conversation summary");
  }
}
