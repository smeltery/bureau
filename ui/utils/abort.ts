import { send } from "../ws.ts";

// Debounce abort sends across all sites (textarea Ctrl+C, ActivityIndicator
// button, mobile Stop). Users tap Ctrl+C twice when the first tap doesn't
// visibly do anything, and the second frame races with the in-flight abort.
const lastAbortAtPerAgent = new Map<string, number>();

export function sendAbortDebounced(agentId: string) {
  const now = performance.now();
  const last = lastAbortAtPerAgent.get(agentId) ?? 0;
  if (now - last < 2000) return;
  lastAbortAtPerAgent.set(agentId, now);
  send({ type: "abort", agentId });
}
