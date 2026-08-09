// The log view's decisions about the subagent marking on a tool_call /
// tool_result row: whether the row is a subagent's work at all, and what the
// pill and its hover title read. Pure, and extracted from the card so they can
// be covered without a React render harness.

import type { LogEntry, SubagentOrigin } from "../../../shared/types.ts";

/**
 * Subagent origin of a tool_call / tool_result row, when the agent's SUBAGENT
 * made the call rather than the agent itself. Written by the Claude backend
 * (see SubagentOrigin); absent on the agent's own calls and on older entries.
 */
export function subagentOf(entry: LogEntry): SubagentOrigin | undefined {
  const origin = entry.metadata?.subagent as SubagentOrigin | undefined;
  return origin?.parentToolUseId ? origin : undefined;
}

/**
 * Pill text. The subagent type is the useful half — it says which kind of
 * subagent ran — but older SDKs omit it, in which case the bare marking still
 * has to distinguish the row from the agent's own work.
 */
export function subagentPillLabel(origin: SubagentOrigin): string {
  return origin.type ? `subagent · ${origin.type}` : "subagent";
}

/**
 * Hover title. Both fields are model-authored, so the pill itself is bounded
 * and ellipsized rather than trusted to be short — the backend's 200-char cap
 * still leaves room for a label that would squeeze a mobile tool row. The full
 * text lives here, composed rather than passed through raw.
 */
export function subagentPillTitle(origin: SubagentOrigin): string {
  return `Subagent${origin.type ? ` (${origin.type})` : ""}` + (origin.description ? `: ${origin.description}` : "");
}
