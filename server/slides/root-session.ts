// The conversation's ROOT session id - the slide deck's storage key and the
// conversation identity Slide Mode's stale guard keys on.
//
// A leaf session is what the agent is talking on right now; an edit-fork adds a
// new leaf but keeps the same root (persistSessionFork stamps `forkedFrom`, the
// same chain loadLogWithAncestors walks to replay a forked conversation). Keying
// the deck on the ROOT therefore means every fork branch of one conversation
// shares one deck, and a /clear (which drops the session entirely) or a /resume
// into an unrelated thread yields a DIFFERENT root - which is exactly the signal
// that in-flight slide work belongs to a conversation that no longer exists.
// A benign topic rename touches none of this, so it can't discard slide work.

import { loadSessionsMap } from "../persistence/logs/sessions.ts";

// The fork chain's map shape, narrowed to what the walk needs (SessionsMap
// satisfies it) so the pure walk is testable without touching disk.
export type ForkChain = Record<string, { forkedFrom?: string } | undefined>;

// Walk from a leaf session to its root. `seen` makes a corrupt cycle terminate
// instead of hanging - a self- or mutually-referential `forkedFrom` stops at the
// first repeat and returns that id, which is stable and therefore still a usable
// deck key.
export function rootSessionIdFrom(chain: ForkChain, leafSessionId: string): string {
  let cur = leafSessionId;
  const seen = new Set<string>();
  while (!seen.has(cur)) {
    seen.add(cur);
    const parent = chain[cur]?.forkedFrom;
    if (!parent) break;
    cur = parent;
  }
  return cur;
}

// The live root for an agent's current leaf session, or null when the agent has
// no conversation at all (post-/clear) - in which case there is no deck to key
// and no conversation for an in-flight result to still belong to.
export function getRootSessionId(agentId: string, leafSessionId: string | null | undefined): string | null {
  if (!leafSessionId) return null;
  return rootSessionIdFrom(loadSessionsMap(agentId), leafSessionId);
}
