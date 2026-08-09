import { describe, expect, test } from "bun:test";
import { slideContentDigest, type DeckTurn } from "../../../shared/slide-turns.ts";
import type { SlideRecord } from "../../../shared/slides.ts";
import {
  anyTurnAwaitingSlide,
  deckLoaded,
  EMPTY_DECK_SLIDES,
  ORPHAN_RETRY_MS,
  requestInFlight,
  slideFailed,
  slideInvalidate,
  slideReady,
  slideRetry,
  spinnerLabel,
  stageKind,
  stageRegenerable,
  turnsToRequest,
  visibleWindow,
  type DeckSlides,
} from "./deck-slides.ts";

function turn(entryId: string, overrides: Partial<DeckTurn> = {}): DeckTurn {
  return { entryId, promptText: `prompt ${entryId}`, assistantText: `answer ${entryId}`, errorText: null, placeholder: false, ...overrides };
}

function record(t: DeckTurn, overrides: Partial<SlideRecord> = {}): SlideRecord {
  return { html: "<section/>", placeholder: false, errorText: null, promptText: t.promptText, model: "sonnet", createdAt: 1, contentDigest: slideContentDigest(t), ...overrides };
}

function withSlides(entries: Array<[string, SlideRecord]>, failed: string[] = []): DeckSlides {
  return { slides: new Map(entries), failed: new Set(failed) };
}

describe("visibleWindow", () => {
  // Generation costs a model call, so the deck asks for what is on screen and
  // one either side - never the whole conversation.
  test("is the focused position plus its two neighbours, clamped", () => {
    expect(visibleWindow(3, 10)).toEqual([3, 4, 2]);
    expect(visibleWindow(0, 10)).toEqual([0, 1]);
    expect(visibleWindow(9, 10)).toEqual([9, 8]);
    expect(visibleWindow(0, 1)).toEqual([0]);
    expect(visibleWindow(0, 0)).toEqual([]);
  });
});

describe("requestInFlight", () => {
  test("a turn never requested is not in flight", () => {
    expect(requestInFlight(undefined, 10_000)).toBe(false);
  });

  test("a fresh request is in flight, so a re-render does not re-ask", () => {
    expect(requestInFlight(1_000, 1_000 + ORPHAN_RETRY_MS - 1)).toBe(true);
    expect(requestInFlight(1_000, 1_000 + ORPHAN_RETRY_MS)).toBe(true);
  });

  // The one thing the clock is for: a request the server dropped without ever
  // reporting an outcome must not orphan the deck forever.
  test("a request past the orphan window counts as gone", () => {
    expect(requestInFlight(1_000, 1_000 + ORPHAN_RETRY_MS + 1)).toBe(false);
  });

  // Before the first tick nowTs is 0, which is BEHIND every stamp - that reads as
  // in-flight, which is the safe direction (no request storm on mount).
  test("an un-ticked clock reads every stamped request as in flight", () => {
    expect(requestInFlight(Date.now(), 0)).toBe(true);
  });
});

describe("turnsToRequest", () => {
  const t1 = turn("u1");
  const t2 = turn("u2");
  const turns = [t1, t2];

  test("asks for every visible turn with no slide", () => {
    expect(turnsToRequest(turns, 0, EMPTY_DECK_SLIDES, new Map(), 1_000)).toEqual(["u1", "u2"]);
  });

  test("skips a verified slide (it carries a digest for immutable content)", () => {
    const state = withSlides([
      ["u1", record(t1)],
      ["u2", record(t2)],
    ]);
    expect(turnsToRequest(turns, 0, state, new Map(), 1_000)).toEqual([]);
  });

  // A record with no digest predates the field, or was rendered from a
  // half-streamed answer: unverifiable, so it is reconciled once.
  test("re-asks for a digestless legacy record", () => {
    const legacy = record(t1);
    delete legacy.contentDigest;
    expect(turnsToRequest([t1], 0, withSlides([["u1", legacy]]), new Map(), 1_000)).toEqual(["u1"]);
  });

  // The one stale state the deck cannot otherwise leave: "this turn produced no
  // answer" about a turn that now has one.
  test("re-asks for a stored placeholder whose turn has since gained an answer", () => {
    const empty = turn("u1", { assistantText: "", placeholder: true });
    const stalePlaceholder = record(empty, { html: null, placeholder: true, contentDigest: slideContentDigest(empty) });
    expect(turnsToRequest([t1], 0, withSlides([["u1", stalePlaceholder]]), new Map(), 1_000)).toEqual(["u1"]);
  });

  test("a placeholder that still matches its turn is left alone", () => {
    const empty = turn("u1", { assistantText: "", placeholder: true });
    const matching = record(empty, { html: null, placeholder: true, contentDigest: slideContentDigest(empty) });
    expect(turnsToRequest([empty], 0, withSlides([["u1", matching]]), new Map(), 1_000)).toEqual([]);
  });

  test("dedupes against a request already in flight", () => {
    expect(turnsToRequest(turns, 0, EMPTY_DECK_SLIDES, new Map([["u1", 1_000]]), 1_000)).toEqual(["u2"]);
  });

  // A reported failure is terminal: re-asking would spend a model call every
  // orphan window on a turn the formatter just choked on.
  test("never re-asks for a turn the server reported failed", () => {
    expect(turnsToRequest(turns, 0, withSlides([], ["u1", "u2"]), new Map(), 1_000)).toEqual([]);
  });
});

describe("anyTurnAwaitingSlide", () => {
  const t1 = turn("u1");

  // The predicate IS turnsToRequest's condition minus the in-flight marker, so
  // the clock cannot drift from the requests it paces.
  test("runs the clock while a visible turn has no verified slide", () => {
    expect(anyTurnAwaitingSlide([t1], 0, EMPTY_DECK_SLIDES)).toBe(true);
  });

  test("stops the clock once every visible turn is verified", () => {
    expect(anyTurnAwaitingSlide([t1], 0, withSlides([["u1", record(t1)]]))).toBe(false);
  });

  test("stops the clock for a reported failure", () => {
    expect(anyTurnAwaitingSlide([t1], 0, withSlides([], ["u1"]))).toBe(false);
  });

  // Absence alone would not be enough here: a digestless record STAYS in the map
  // while it is reconciled, so an absence-only test would stop the clock and that
  // record would never retry.
  test("keeps the clock running for a digestless record that is still in the map", () => {
    const legacy = record(t1);
    delete legacy.contentDigest;
    expect(anyTurnAwaitingSlide([t1], 0, withSlides([["u1", legacy]]))).toBe(true);
  });
});

describe("outcome folding", () => {
  const t1 = turn("u1");

  test("the deck GET replaces both halves", () => {
    const loaded = deckLoaded({ u1: record(t1) });
    expect(loaded.slides.get("u1")?.html).toBe("<section/>");
    expect(loaded.failed.size).toBe(0);
  });

  test("a slide landing retires that turn's failure mark", () => {
    const next = slideReady(withSlides([], ["u1"]), "u1", record(t1));
    expect(next.slides.has("u1")).toBe(true);
    expect(next.failed.has("u1")).toBe(false);
  });

  test("a reported failure is recorded once and is idempotent", () => {
    const once = slideFailed(EMPTY_DECK_SLIDES, "u1");
    expect(once.failed.has("u1")).toBe(true);
    expect(slideFailed(once, "u1")).toBe(once);
  });

  test("an explicit regenerate retires the failure mark so the spinner comes back", () => {
    expect(slideRetry(withSlides([], ["u1"]), "u1").failed.has("u1")).toBe(false);
    // Nothing to retire is a no-op, not a fresh object.
    const clean = EMPTY_DECK_SLIDES;
    expect(slideRetry(clean, "u1")).toBe(clean);
  });

  test("invalidate drops the exact placeholder it was handed", () => {
    const placeholder = record(t1, { html: null, placeholder: true });
    const next = slideInvalidate(withSlides([["u1", placeholder]]), "u1", placeholder);
    expect(next.slides.has("u1")).toBe(false);
  });

  // Compare-AND-delete: a slide_ready that already replaced the placeholder wins,
  // so a late invalidate cannot blank a slide that has arrived.
  test("invalidate is a no-op once the record has been replaced", () => {
    const placeholder = record(t1, { html: null, placeholder: true });
    const state = withSlides([["u1", record(t1)]]);
    expect(slideInvalidate(state, "u1", placeholder)).toBe(state);
  });
});

describe("stageKind", () => {
  const t1 = turn("u1");

  test("a committed placeholder wins over its (absent) html", () => {
    expect(stageKind(record(t1, { html: null, placeholder: true }), false, true)).toBe("placeholder");
    // A placeholder record that somehow also carries html is still a placeholder:
    // the flag is the server's statement about the turn.
    expect(stageKind(record(t1, { placeholder: true }), false, true)).toBe("placeholder");
  });

  test("html renders the slide", () => {
    expect(stageKind(record(t1), false, true)).toBe("html");
  });

  // The raw-answer fallback is for a REPORTED failure and nothing else.
  test("a reported failure with a turn to fall back to shows the raw answer", () => {
    expect(stageKind(undefined, true, true)).toBe("fallback");
  });

  test("a reported failure with no turn left has nothing to show, so it spins", () => {
    expect(stageKind(undefined, true, false)).toBe("spinner");
  });

  test("everything else is a spinner, for as long as it takes", () => {
    expect(stageKind(undefined, false, true)).toBe("spinner");
    // An empty-html record that is not flagged placeholder is not a slide yet.
    expect(stageKind(record(t1, { html: "" }), false, true)).toBe("spinner");
  });

  test("a drawn state offers regenerate; a spinner has nothing to redo", () => {
    expect(stageRegenerable("html")).toBe(true);
    expect(stageRegenerable("placeholder")).toBe(true);
    expect(stageRegenerable("fallback")).toBe(true);
    expect(stageRegenerable("spinner")).toBe(false);
  });

  test("the spinner names what is actually happening at each position", () => {
    expect(spinnerLabel(true)).toBe("Generating");
    expect(spinnerLabel(false)).toBe("Designing slide");
  });
});
