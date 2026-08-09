import { useCallback, useEffect, useRef, useState } from "react";

import type { AgentState, AgentSubscriptionUsage } from "../../../shared/types.ts";

// The plan-allowance reading behind the header's usage pill, pulled from
// GET /api/agents/:id/subscription-usage.
//
// PULLED rather than pushed over the agent event stream, because the value
// describes the provider ACCOUNT rather than this conversation: it survives
// /clear, fork and resume, and the server keeps the committed reading so a
// failed read leaves the last number standing. The request itself is cheap by
// construction — Codex serves rate limits its app-server already pushed, and
// the Claude backend throttles its control RPC to once a minute — so asking at
// every turn boundary costs about what a turn already costs.
//
// Refresh points, in the order they matter:
//   - mount: the pill has the same lifecycle as the context battery, so it must
//     have a number as soon as the log view opens.
//   - leaving a busy state: the turn boundary, which is when a plan number can
//     actually have moved.
//   - opening the popover: an explicit "tell me now" from the viewer.
const BUSY_STATES: ReadonlySet<AgentState> = new Set<AgentState>(["thinking", "tool_executing"]);

export function useSubscriptionUsage(agentId: string): { usage: AgentSubscriptionUsage | null; refresh: () => void } {
  const [usage, setUsage] = useState<AgentSubscriptionUsage | null>(null);
  // Guards against a burst of refresh triggers (mount plus an immediate turn
  // boundary) stacking requests, and against writing state after unmount.
  const inFlight = useRef(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    fetch(`/api/agents/${encodeURIComponent(agentId)}/subscription-usage`, { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { usage?: AgentSubscriptionUsage | null } | null) => {
        // A failed or unauthorized request is not an answer: keep whatever the
        // pill was showing rather than blanking a valid number.
        if (live.current && body) setUsage(body.usage ?? null);
      })
      .catch(() => {})
      .finally(() => {
        inFlight.current = false;
      });
  }, [agentId]);

  return { usage, refresh };
}

// Fire `refresh` once on mount and again whenever the agent leaves a busy
// state, i.e. at each turn boundary. Split from the hook above so the trigger
// policy is readable on its own.
export function useSubscriptionUsageRefreshOnTurnEnd(state: AgentState, refresh: () => void): void {
  const wasBusy = useRef(false);
  useEffect(() => {
    refresh();
  }, [refresh]);
  useEffect(() => {
    const busy = BUSY_STATES.has(state);
    if (wasBusy.current && !busy) refresh();
    wasBusy.current = busy;
  }, [state, refresh]);
}
