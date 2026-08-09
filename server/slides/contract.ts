// Slide Mode's injected-deps contract: everything the generator needs to reach
// live state, plus the two pure decisions that hang off it (which model family
// the formatter runs on, and whether a cached slide still matches its turn).
//
// Keeping this separate from ./generate.ts is what keeps the generator ignorant
// of the agent manager: a consumer implements SlideModeDeps, and the generation
// lifecycle is testable without a live agent.

import type { AgentBackendType } from "../../shared/agent-types.ts";
import type { SlideFailureReason, SlideRecord } from "../../shared/slides.ts";
import { slideContentDigest, type DeckTurn } from "../../shared/slide-turns.ts";

// The formatter runs on a fixed cheap tier per backend, NOT the agent's own
// family (which may be a pricey frontier model): Claude -> sonnet, Codex ->
// terra. Same rule as topic generation, which also lets the backend map the
// family to an exact model (FAMILY_TO_MODEL for Claude).
export const SLIDE_CODEX_MODEL_FAMILY = "gpt-5.6-terra";

export function slideModelFamily(agentType: AgentBackendType): string {
  return agentType === "claude" ? "sonnet" : SLIDE_CODEX_MODEL_FAMILY;
}

export interface SlideJobContext {
  agentType: string;
  // Already resolved to the formatter family: "sonnet" for Claude, a cheap
  // GPT-5.x family for Codex (see slideModelFamily).
  modelFamily: string;
  cwd: string;
  // The conversation's ROOT session id: both the deck's storage key and the
  // conversation identity captured at request time. Re-checked after the async
  // generation so a result that lands once the conversation moved on is dropped.
  // /clear leaves the agent with no root at all and a /resume into a different
  // thread changes it, while a benign setTopic leaves it alone - a topic rename
  // must not discard in-flight slide work. An edit-fork KEEPS the root and
  // changes the turn's content instead, which the commit digest check catches:
  // conversation identity is the cheap early-out, the digest is the guarantee.
  rootSessionId: string;
  turn: DeckTurn;
  // The previous turn's cached slide HTML, for style continuity (null when the
  // viewer jumped mid-deck and it isn't cached - we do not force a chain).
  prevSlideHtml: string | null;
  // Is this turn TERMINAL - i.e. is it NOT the anchor of the still-running turn?
  // The core invariant: a slide is generated (or placeholdered) only for a
  // terminal turn. The newest turn while the agent is mid-response is
  // non-terminal; ensureSlide gates it (registers a deferred waiter, returns
  // pending) instead of formatting a half-streamed answer or recording a
  // placeholder that the arriving answer would immediately make stale.
  terminal: boolean;
}

// Is a cached slide still valid for the live terminal turn? The reconciliation
// predicate, independent of event timing: the stored content digest must equal
// the turn's current digest. A slide recorded as a placeholder for a turn that
// has since gained text (the send-from-slide-mode race) no longer matches and is
// regenerated. A record with NO digest predates this field and is unverifiable -
// it could be a placeholder the turn outgrew, or a slide the old code rendered
// from a half-streamed answer - so it is treated as stale and regenerated once
// (a placeholder regen is a no-LLM re-commit; a rendered slide regenerates and
// gains a digest, after which it validates and is served from cache).
export function slideMatchesTurn(cached: SlideRecord, turn: DeckTurn): boolean {
  return cached.contentDigest === slideContentDigest(turn);
}

export interface SlideBackend {
  oneShotPrompt(prompt: string, opts: { cwd?: string; modelFamily: string; systemPrompt?: string }): Promise<string>;
}

export interface SlideModeDeps {
  resolveBackend: (agentType: string) => SlideBackend;
  // Resolve everything a generation needs from LIVE state, or null when the
  // agent / session / turn is gone. Called once per ensureSlide.
  resolveJob: (agentId: string, entryId: string) => SlideJobContext | null;
  // Is `rootSessionId` still the agent's current conversation root? A captured
  // root is always non-null (resolveJob returns null when there is none), so an
  // agent left rootless by /clear never matches and its in-flight work is
  // dropped.
  isCurrent: (agentId: string, rootSessionId: string) => boolean;
  readSlide: (agentId: string, rootSessionId: string, entryId: string) => SlideRecord | null;
  writeSlide: (agentId: string, rootSessionId: string, entryId: string, rec: SlideRecord) => void;
  onSlideReady: (agentId: string, rootSessionId: string, entryId: string, rec: SlideRecord) => void;
  // A generation ended in a TERMINAL failure for a turn that is still the live
  // one: the formatter threw, or its output violated the slide contract. The
  // client can't infer this - a failure and a slow generation look identical on
  // the wire - so this is what lets the deck stop waiting without a timeout.
  // Not called when the result was merely DISCARDED (the conversation reset, or
  // the turn's content moved on): that isn't a failure, and a fresh request will
  // follow.
  onSlideFailed: (agentId: string, rootSessionId: string, entryId: string, reason: SlideFailureReason) => void;
  // Injectable clock (Date.now in production) so tests stay deterministic.
  now?: () => number;
}

export type EnsureResult = { status: "ready"; slide: SlideRecord } | { status: "pending" } | { status: "unavailable" };
