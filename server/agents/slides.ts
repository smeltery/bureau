// Slide Mode's manager wiring: the one place the generation lifecycle in
// server/slides/* is joined to live agent state.
//
// A slide is a nullable attribute of an assistant turn, generated on demand when
// a client views it in the deck. Storage keys by the conversation's ROOT session
// id so edit-forks of the same conversation share a deck. The staleness guard
// keys on that same root session id (conversation identity): /clear and /resume
// change it, dropping in-flight slide work for the old conversation, while a
// benign setTopic does NOT — so a topic rename can't discard a slide that's
// generating. An edit-fork keeps the root but changes the turn's content, caught
// by the commit digest check.
//
// Everything the generator needs arrives through SlideModeDeps, so this module is
// the only one that knows both halves. It stays free of the HTTP layer: the
// routes in server/http/agent-slides.ts consume getSlideDeck / ensureSlide.

import { getBackend } from "../backends/index.ts";
import { createSlideMode, slideModelFamily } from "../slides/generate.ts";
import type { SlideJobContext } from "../slides/generate.ts";
import { getRootSessionId } from "../slides/root-session.ts";
import { readDeck, readSlide, writeSlide } from "../slides/store.ts";
import { buildDeckTurns, turnIsTerminal } from "../../shared/slide-turns.ts";
import type { AgentBackendType, SlideDeckRes } from "../../shared/types.ts";
import { agents, emit, logCache, type ManagedAgent } from "./state.ts";

// The anchor of the turn the agent is producing RIGHT NOW, or null when it is
// producing nothing. Two sources, because a turn is claimed by the agent well
// before its deferred exists: sendMessage / executeSkill / editMessage log the
// user_message and flip the agent busy in one synchronous block, but only reach
// createTurnDeferred after the plugin phase (an afterTurn gate, beforeTurn hooks)
// — hundreds of ms in which the deck client, which saw the message the instant it
// was logged, asks for its slide. Reading the parked anchor while the agent is
// BUSY covers that window; without it the live turn reads terminal and gets an
// empty-turn placeholder written over it.
//
// Two things keep the park honest. The busy gate: a user_message that never
// starts a turn (a control command's echo — /model, /effort and friends log one
// and answer with a system entry) leaves a park behind that must NOT make that
// position look in-flight, and an idle agent by definition has no live turn. And
// the deferred taking precedence: once a turn owns a deferred, that is the whole
// answer, so a queued flush — which logs its own anchor after the send — reads
// anchorless rather than inheriting a leftover park.
//
// Pure over the fields it reads, so the terminal boundary is provable without
// standing up a manager.
export function liveTurnAnchor(managed: Pick<ManagedAgent, "pendingTurn" | "info" | "nextTurnAnchorEntryId">): string | null {
  if (managed.pendingTurn) return managed.pendingTurn.anchorEntryId;
  const busy = managed.info.state === "thinking" || managed.info.state === "tool_executing";
  return busy ? managed.nextTurnAnchorEntryId : null;
}

// Resolve everything a slide generation needs from live state (called by the
// generator once per request), or null when the agent / session / turn is gone.
// Captures the conversation's root session id NOW so a result that lands after a
// conversation reset is dropped at commit.
function resolveSlideJob(agentId: string, entryId: string): SlideJobContext | null {
  const managed = agents.get(agentId);
  if (!managed?.sessionId) return null;
  const rootSessionId = getRootSessionId(agentId, managed.sessionId);
  if (!rootSessionId) return null;
  const turns = buildDeckTurns(logCache.get(agentId) ?? []);
  const idx = turns.findIndex((t) => t.entryId === entryId);
  if (idx < 0) return null;
  // Style reference: the previous turn's cached slide, when we have it. Not
  // forced — a viewer who jumped mid-deck gets no chain rather than a cascade of
  // generations.
  const prevEntryId = idx > 0 ? turns[idx - 1]!.entryId : null;
  const prevSlideHtml = prevEntryId ? (readSlide(agentId, rootSessionId, prevEntryId)?.html ?? null) : null;
  return {
    agentType: managed.info.agentType,
    // A fixed cheap tier per backend, NOT the agent's own family (which may be a
    // pricey frontier model).
    modelFamily: slideModelFamily(managed.info.agentType),
    cwd: managed.info.cwd,
    // Doubles as the conversation identity the commit guard re-checks.
    rootSessionId,
    turn: turns[idx]!,
    prevSlideHtml,
    // Terminal iff this turn is NOT the anchor of the still-running turn (see
    // turnIsTerminal). Once the turn completes pendingTurn is nulled, so every
    // turn reads terminal. BOOT is an authoritative terminal boundary, not merely
    // "absence happens to read terminal": a restart kills the backend process,
    // restore rebuilds the agent with pendingTurn=null, and the dead turn cannot
    // emit more output — any later resume sends under a NEW user_message anchor
    // rather than continuing the persisted tail. So a persisted partial last turn
    // is genuinely terminal after boot, and its slide faithfully reflects the
    // (possibly truncated) transcript.
    terminal: turnIsTerminal(liveTurnAnchor(managed), entryId),
  };
}

export const slideMode = createSlideMode({
  resolveBackend: (agentType) => getBackend(agentType as AgentBackendType),
  resolveJob: resolveSlideJob,
  isCurrent: (agentId, rootSessionId) => {
    // The null check is redundant against a captured root (always non-null) but
    // states the boundary outright: an agent with no current conversation at all
    // — /clear nulls sessionId, so getRootSessionId returns null — is never
    // "current", and its in-flight slide work is dropped.
    const managed = agents.get(agentId);
    const currentRoot = managed ? getRootSessionId(agentId, managed.sessionId) : null;
    return currentRoot !== null && currentRoot === rootSessionId;
  },
  readSlide: (agentId, rootSessionId, entryId) => readSlide(agentId, rootSessionId, entryId),
  writeSlide: (agentId, rootSessionId, entryId, rec) => writeSlide(agentId, rootSessionId, entryId, rec),
  onSlideReady: (agentId, sessionId, entryId, slide) => emit({ type: "slide_ready", agentId, sessionId, entryId, slide }),
  onSlideFailed: (agentId, sessionId, entryId, reason) => emit({ type: "slide_failed", agentId, sessionId, entryId, reason }),
});

// The conversation's slide map for the initial deck render. Returns null when the
// agent has no live session; the route turns that into an empty deck rather than
// an error. We do NOT prune: the root deck is shared across resumable fork
// branches, so keys the current leaf can't see may be another branch's live
// slides (see server/slides/store.ts).
export function getSlideDeck(agentId: string): SlideDeckRes | null {
  const managed = agents.get(agentId);
  if (!managed) return null;
  const rootSessionId = getRootSessionId(agentId, managed.sessionId);
  if (!rootSessionId) return null;
  return { sessionId: rootSessionId, slides: readDeck(agentId, rootSessionId) };
}

// Ensure a slide exists for one turn: cached comes back immediately, otherwise
// generation starts and this answers pending (the finished slide arrives on the
// slide_ready push). `force`/`feedback` drive the per-slide regenerate.
export const ensureSlide = slideMode.ensureSlide;
