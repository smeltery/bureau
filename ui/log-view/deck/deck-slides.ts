// The deck's slide bookkeeping, as pure functions.
//
// Bureau has no React render harness, so every decision the deck makes about a
// slide — which turns to ask the server for, when a request counts as orphaned,
// what the stage should draw, and how each outcome folds into local state — lives
// here and is covered directly. The view (DeckView / SlideStage) only wires these
// to effects and JSX. Same split as ui/apps-view/appVerbs.ts.

import { shouldRequestSlide, slideContentDigest, type DeckTurn } from "../../../shared/slide-turns.ts";
import type { SlideRecord } from "../../../shared/slides.ts";

// What the deck shows for a slide that isn't here yet is decided by REPORTED
// state, never by elapsed time: the spinner while it is pending, the raw-answer
// fallback once the server says the generation failed (`slide_failed`, or an
// `unavailable` ensure response). A timeout can't tell a failure from a slow
// generation - and generation genuinely takes 17-30s - so any threshold either
// slanders working slides or hides real failures.
//
// The one thing time is still good for: a request the server dropped WITHOUT
// reporting an outcome (its conversation reset, its turn forked away, or the
// server restarted mid-generation). This window is how long we let such a
// request sit before quietly asking again. It never changes what is on screen, so
// it can afford to be well clear of the slowest real generation.
export const ORPHAN_RETRY_MS = 120_000;

// How often the deck re-reads the clock while a visible turn is still waiting.
// Paces retries only; nothing on screen depends on it.
export const ORPHAN_TICK_MS = 5_000;

// The deck's local slide state. `slides` is what the server has committed for
// this conversation; `failed` is the set of turns whose generation the server
// reported as terminally failed. A failure is terminal: no auto-retry (a
// formatter that broke the slide contract on this turn will most likely break it
// again), so the raw answer stands until the viewer asks again.
export interface DeckSlides {
  slides: ReadonlyMap<string, SlideRecord>;
  failed: ReadonlySet<string>;
}

export const EMPTY_DECK_SLIDES: DeckSlides = { slides: new Map(), failed: new Set() };

// The deck GET landing. REPLACES both halves: the response is the authoritative
// snapshot of the conversation's committed slides, and a failure mark describes a
// generation attempt, not the conversation - carrying marks across a reload would
// keep a turn on the fallback that the server may since have rendered.
export function deckLoaded(records: Readonly<Record<string, SlideRecord>>): DeckSlides {
  return { slides: new Map(Object.entries(records)), failed: new Set() };
}

// A slide landed (the slide_ready push, or a `ready` ensure response). Retires
// any failure mark for that turn: a committed slide is the newer fact.
export function slideReady(state: DeckSlides, entryId: string, slide: SlideRecord): DeckSlides {
  const slides = new Map(state.slides);
  slides.set(entryId, slide);
  if (!state.failed.has(entryId)) return { slides, failed: state.failed };
  const failed = new Set(state.failed);
  failed.delete(entryId);
  return { slides, failed };
}

// The server reported a terminal failure (slide_failed, or an `unavailable`
// ensure response - there is no live turn to render, which has the same standing:
// show the raw answer and stop asking).
export function slideFailed(state: DeckSlides, entryId: string): DeckSlides {
  if (state.failed.has(entryId)) return state;
  const failed = new Set(state.failed);
  failed.add(entryId);
  return { slides: state.slides, failed };
}

// An explicit regenerate retires the failure mark, so the deck goes back to the
// spinner and the request effect resumes owning this turn.
export function slideRetry(state: DeckSlides, entryId: string): DeckSlides {
  if (!state.failed.has(entryId)) return state;
  const failed = new Set(state.failed);
  failed.delete(entryId);
  return { slides: state.slides, failed };
}

// Drop a stale PLACEHOLDER the server has told us it is regenerating, so the deck
// shows the spinner instead of a misleading "No answer" card. COMPARE-and-delete:
// a slide_ready that already replaced the record wins, because the identity check
// fails and this becomes a no-op.
export function slideInvalidate(state: DeckSlides, entryId: string, prevSlide: SlideRecord): DeckSlides {
  if (state.slides.get(entryId) !== prevSlide) return state;
  const slides = new Map(state.slides);
  slides.delete(entryId);
  return { slides, failed: state.failed };
}

// The turns the deck asks for: the focused slide and its two neighbours. NOT the
// whole conversation - a slide costs a model call, so generation is view-driven.
export function visibleWindow(index: number, len: number): number[] {
  return [index, index + 1, index - 1].filter((i) => i >= 0 && i < len);
}

// A request past the orphan window counts as no longer in flight, so one the
// server dropped without reporting an outcome is asked again instead of orphaning
// the deck forever. A slow-but-live generation just re-asks and the server dedupes
// into the running one. An unstamped turn was never requested.
export function requestInFlight(requestedAt: number | undefined, nowTs: number, orphanMs = ORPHAN_RETRY_MS): boolean {
  return requestedAt !== undefined && nowTs - requestedAt <= orphanMs;
}

// The visible turns to POST ensure-slide for, in request order. A cached record
// carrying a digest is verified (written by the terminal gate for content
// immutable within the conversation) and skipped; a miss or a digestless legacy
// record is (re)validated by the server. The digest is compared only to catch a
// stored PLACEHOLDER for a turn that has since gained an answer - the one stale
// state the deck can't otherwise leave. See shouldRequestSlide.
export function turnsToRequest(turns: readonly DeckTurn[], index: number, state: DeckSlides, requestedAt: ReadonlyMap<string, number>, nowTs: number): string[] {
  const wanted: string[] = [];
  for (const i of visibleWindow(index, turns.length)) {
    const turn = turns[i]!;
    const inFlight = requestInFlight(requestedAt.get(turn.entryId), nowTs);
    if (!shouldRequestSlide(state.slides.get(turn.entryId), inFlight, state.failed.has(turn.entryId), slideContentDigest(turn))) continue;
    wanted.push(turn.entryId);
  }
  return wanted;
}

// Should the orphan clock be running? This IS turnsToRequest's condition minus
// the in-flight marker, so the two can never drift. Absence alone is NOT enough:
// a digestless legacy record is unverifiable and is being reconciled, but unlike a
// placeholder (which the invalidate path deletes) it stays in the map, so an
// absence-only test would leave the clock stopped and that record would never
// retry.
export function anyTurnAwaitingSlide(turns: readonly DeckTurn[], index: number, state: DeckSlides): boolean {
  return visibleWindow(index, turns.length).some((i) => {
    const turn = turns[i]!;
    return shouldRequestSlide(state.slides.get(turn.entryId), false, state.failed.has(turn.entryId), slideContentDigest(turn));
  });
}

// What the stage draws for the focused position.
//   html        - the generated slide, in the sandboxed iframe.
//   placeholder - a committed record for a turn with no answer (empty /
//                 interrupted / tool-only), so the deck stays 1:1 with the chat.
//   fallback    - the raw answer, shown ONLY for a REPORTED failure. Every other
//                 reason a slide isn't here (the turn hasn't settled, the request
//                 is parked server-side, the formatter is still working) is a
//                 spinner, for as long as it takes.
//   spinner     - waiting.
export type StageKind = "html" | "placeholder" | "fallback" | "spinner";

export function stageKind(slide: SlideRecord | undefined, failed: boolean, hasTurn: boolean): StageKind {
  if (slide?.placeholder) return "placeholder";
  if (slide?.html) return "html";
  if (failed && hasTurn) return "fallback";
  return "spinner";
}

// Only the three drawn states offer regenerate. A spinner has nothing to redo -
// a second request would dedupe into the generation already running.
export function stageRegenerable(kind: StageKind): boolean {
  return kind !== "spinner";
}

// The newest position reads "Generating" (its turn may still be producing an
// answer, or its slide is being designed); a past position can only be designing.
export function spinnerLabel(isNewest: boolean): string {
  return isNewest ? "Generating" : "Designing slide";
}
