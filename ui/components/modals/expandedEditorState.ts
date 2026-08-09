// Who owns the Escape key while an expanded (near-fullscreen) textarea editor
// is open.
//
// Every host dialog registers a CAPTURE-phase window keydown that closes the
// dialog on Escape, and those listeners were registered before the overlay
// mounted, so they run first and would close the whole dialog out from under an
// expanded editor. Hosts therefore consult isExpandedEditorOpen() (via
// shouldHostCloseOnEscape) and stand down while one is open; the overlay's own
// handler closes just itself.
//
// Kept in its own module — separate from the component — so the decision is a
// pure function that can be tested without a React renderer, and so any host
// can import the predicate without pulling in the overlay's JSX.

// How many expanded editors are currently mounted (0 or 1 in practice; a
// counter rather than a boolean so an unmount can never zero out a newer one).
let openCount = 0;

/** Called when an expanded editor mounts. */
export function openExpandedEditor(): void {
  openCount++;
}

/** Called when an expanded editor unmounts. Clamped at zero so an unbalanced
 *  close can never drive the counter negative — a negative count would make the
 *  next genuinely-open editor read as closed and hand Escape back to the host. */
export function closeExpandedEditor(): void {
  openCount = Math.max(0, openCount - 1);
}

/** True while a full-screen editor is open. Host dialogs must not act on
 *  Escape while this holds - the overlay consumes that key. */
export function isExpandedEditorOpen(): boolean {
  return openCount > 0;
}

/** Whether a host dialog's Escape handler should run for this event. False for
 *  every non-Escape key (hosts only care about Escape) and false while an
 *  expanded editor is open, because collapsing that editor is the whole action.
 *  Takes just the `key` so it is callable with a plain object in tests. */
export function shouldHostCloseOnEscape(event: Pick<KeyboardEvent, "key">): boolean {
  return event.key === "Escape" && !isExpandedEditorOpen();
}

/** Test-only: drop the counter back to zero between cases, since it is
 *  module-level state shared by every importer. */
export function resetExpandedEditorState(): void {
  openCount = 0;
}
