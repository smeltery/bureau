import type { AgentInfo } from "../../../shared/types.ts";

// Whether a past user message may be edited to fork the conversation from that
// point.
//
// Three conditions, and the third is the one that is easy to forget. Editing is
// implemented as a session FORK, and forking is a Claude SDK operation
// (server/agents/conversation/edit.ts imports forkSession from the SDK) — so a
// backend that cannot fork has no way to honour the affordance. Each backend
// declares that for itself in its own capability set (the Codex backend sets
// `fork: false`), and this is where that declaration is believed rather than
// re-derived from the agent's type: a future backend gets the right behaviour by
// declaring it, not by being special-cased here.
//
// Defaults to allowing when the field is absent, so an agent record persisted
// before capabilities existed keeps working; the server refuses independently,
// which is what makes that default safe rather than optimistic.
export function canEditMessage(agent: Pick<AgentInfo, "state" | "capabilities">, opts: { isUserMessage: boolean; alreadyEditing: boolean }): boolean {
  if (!opts.isUserMessage || opts.alreadyEditing) return false;
  if (agent.state !== "waiting_for_response" && agent.state !== "stopped") return false;
  return agent.capabilities?.fork !== false;
}
