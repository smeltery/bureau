// The deck's slide lifecycle: load the committed deck, request the visible
// turns' slides on demand, and fold every outcome (HTTP response or WS push) into
// local state. Every decision it makes lives in ./deck-slides.ts; this file is the
// effects wiring only.
//
// State is LOCAL to the open deck rather than in the app store: a deck GET is
// cheap and costs no model call, so re-reading it when the viewer comes back from
// chat view is simpler than keeping a slice of the store in step with a
// conversation that may have been cleared, forked or resumed while they were away.

import { useEffect, useRef, useState } from "react";
import { addRawListener, removeRawListener } from "../../ws.ts";
import type { DeckTurn } from "../../../shared/slide-turns.ts";
import type { ServerMessage } from "../../../shared/types.ts";
import { deckLoaded, slideFailed, slideInvalidate, slideReady, slideRetry, anyTurnAwaitingSlide, turnsToRequest, EMPTY_DECK_SLIDES, ORPHAN_TICK_MS, type DeckSlides } from "./deck-slides.ts";
import { ensureSlide as postEnsureSlide, fetchSlideDeck } from "./slidesApi.ts";

export interface DeckSlidesController {
  state: DeckSlides;
  // Explicit per-slide regenerate, optionally with a one-shot instruction.
  regenerate: (entryId: string, feedback?: string) => void;
}

export function useDeckSlides(agentId: string, turns: readonly DeckTurn[], index: number, hydrationEpoch: number): DeckSlidesController {
  const [state, setState] = useState<DeckSlides>(EMPTY_DECK_SLIDES);
  // Per-turn request bookkeeping: entryId -> the time we POSTed ensure-slide.
  // Dedupes requests across renders, and dates them for the orphan retry. This is
  // IN-FLIGHT state, not "ever requested": a request that reaches a terminal
  // outcome frees its entry so a later content change can re-request.
  const requestedRef = useRef<Map<string, number>>(new Map());
  // A ticking clock, advanced by the interval below, so the orphan window is
  // derived from state rather than read from Date.now() during render.
  const [nowTs, setNowTs] = useState(0);

  // Load (and reload) the committed deck. Keyed on hydrationEpoch as well as the
  // agent: a reconnect can replay a transcript that disagrees with what we hold,
  // and `connected` is not something every reconnect flips.
  useEffect(() => {
    let live = true;
    requestedRef.current = new Map();
    setState(EMPTY_DECK_SLIDES);
    fetchSlideDeck(agentId)
      .then((res) => {
        if (live) setState(deckLoaded(res.slides));
      })
      .catch(() => {
        // A deck we could not read is an empty deck: every visible turn is then
        // requested individually, which is the same path a genuinely empty deck
        // takes.
      });
    return () => {
      live = false;
    };
  }, [agentId, hydrationEpoch]);

  // Slide outcomes for THIS agent, straight off the socket. A raw listener
  // (rather than a store action) survives reconnects and keeps the deck's slice
  // out of the global reducer.
  useEffect(() => {
    function onRaw(data: string) {
      let msg: ServerMessage | null = null;
      try {
        msg = JSON.parse(data) as ServerMessage;
      } catch {
        return;
      }
      if (!msg || (msg.type !== "slide_ready" && msg.type !== "slide_failed")) return;
      if (msg.agentId !== agentId) return;
      if (msg.type === "slide_ready") {
        // Terminal: the slide is in hand. Free the in-flight marker so a later
        // content change can legitimately re-request this turn.
        requestedRef.current.delete(msg.entryId);
        setState((prev) => slideReady(prev, msg.entryId, msg.slide));
        return;
      }
      requestedRef.current.delete(msg.entryId);
      setState((prev) => slideFailed(prev, msg.entryId));
    }
    addRawListener(onRaw);
    return () => removeRawListener(onRaw);
  }, [agentId]);

  function ensure(entryId: string, opts: { force?: boolean; feedback?: string }) {
    // The exact record shown at request time. Only a stale PLACEHOLDER is worth
    // replacing with a spinner (its "No answer" card is misleading); a rendered
    // slide being reconciled stays on screen until its replacement lands, which is
    // smoother. Captured now, not when the response returns.
    const prevSlide = state.slides.get(entryId);
    postEnsureSlide(agentId, entryId, opts)
      .then((res) => {
        if (res.status === "ready") {
          requestedRef.current.delete(entryId);
          setState((prev) => slideReady(prev, entryId, res.slide));
        } else if (res.status === "unavailable") {
          // Terminal: there is no live turn to render (the conversation is gone,
          // or this turn isn't in it). Same standing as a reported failure - show
          // the raw answer with a regenerate affordance rather than spinning
          // forever, and stop asking.
          requestedRef.current.delete(entryId);
          setState((prev) => slideFailed(prev, entryId));
        } else if (prevSlide?.placeholder) {
          // Still in flight (keep the marker): the server is regenerating a stale
          // placeholder we currently show. Drop it so the deck shows the spinner
          // meanwhile; the slide arrives on the slide_ready push, which clears the
          // marker.
          setState((prev) => slideInvalidate(prev, entryId, prevSlide));
        }
      })
      .catch(() => {
        // The request never reached the server: drop the marker so a later pass
        // can re-request.
        requestedRef.current.delete(entryId);
      });
  }

  // Ensure the focused slide + its two neighbours. There is NO client-side "is the
  // turn settled?" guess: the server authoritatively gates generation on the
  // turn's terminal fact (an in-flight newest turn comes back `pending` and is
  // filled by slide_ready when it completes). We just request what's visible.
  useEffect(() => {
    for (const entryId of turnsToRequest(turns, index, state, requestedRef.current, nowTs)) {
      requestedRef.current.set(entryId, Date.now());
      ensure(entryId, {});
    }
  }, [agentId, turns, index, state, nowTs]);

  // While a VISIBLE turn still lacks a verified slide and hasn't been reported
  // failed, tick so the request effect can re-ask once the orphan window lapses.
  // Keyed on the same visible window as that effect, `index` included: navigating
  // to an unverified turn starts a request without changing `turns` or `state`, and
  // requestedRef is a ref - so without `index` here the clock would never start for
  // it and an orphaned request would never retry.
  useEffect(() => {
    if (!anyTurnAwaitingSlide(turns, index, state)) return;
    // The interval alone drives the clock - no immediate set, which would be a
    // render-in-effect. Until the first tick nowTs stays behind the request
    // stamps, which reads as "in flight": the safe direction.
    const handle = setInterval(() => setNowTs(Date.now()), ORPHAN_TICK_MS);
    return () => clearInterval(handle);
  }, [turns, index, state]);

  function regenerate(entryId: string, feedback?: string) {
    requestedRef.current.set(entryId, Date.now());
    setState((prev) => slideRetry(prev, entryId));
    ensure(entryId, { force: true, ...(feedback ? { feedback } : {}) });
  }

  return { state, regenerate };
}
