// Slide Mode shared types. One rendered slide for one assistant turn, keyed
// server-side by the turn's user_message entry id.

// Why a turn has no slide to show. A CLOSED set of codes, deliberately: the
// underlying errors are backend/provider exception text and raw model output,
// which are neither a stable contract nor something to broadcast to every
// session that can see the room. Full detail stays in the server journal.
//   generation_failed - the formatter call itself failed.
//   invalid_output    - it answered, but broke the slide contract.
//   unavailable       - client-local: there is no live turn to render.
export type SlideFailureReason = "generation_failed" | "invalid_output" | "unavailable";

// Shared by the sidecar store, the ensure-slide API, and the slide_ready WS push
// so all three agree on the shape.
export interface SlideRecord {
  // The self-contained inline-styled HTML fragment, or null for a
  // placeholder-only record (an empty / interrupted / tool-only turn that has
  // no text to format). Rendered ONLY inside a sandboxed iframe, never injected
  // into the app DOM.
  html: string | null;
  // True when the turn produced no assistant text - the deck still shows a
  // placeholder so it mirrors the conversation 1:1.
  placeholder: boolean;
  // The turn's error text (when it failed), shown on the placeholder. Null
  // otherwise.
  errorText: string | null;
  // The frozen prompt that started the turn (shown beneath the slide).
  promptText: string;
  // The backend model family the formatter ran on (e.g. "sonnet").
  model: string;
  createdAt: number;
  // Digest of the turn CONTENT this slide was generated from (prompt + answer +
  // error, via slideContentDigest). The cache-validity signal: a stored slide is
  // served only while this equals the live turn's digest - a turn that gained
  // text after a placeholder was recorded no longer matches and is regenerated.
  // Optional so slide files written before this field (self-hosters) still load;
  // a record with no digest is unverifiable and is regenerated once on next view.
  contentDigest?: string;
}

// One conversation's slides, keyed by the turn's anchor (user_message) entry id.
// The wire shape of a deck as well as the stored one - the initial deck render
// and the sidecar file agree by construction.
export type SlideDeck = Record<string, SlideRecord>;
