import { beforeEach, describe, expect, test } from "bun:test";
import { closeExpandedEditor, isExpandedEditorOpen, openExpandedEditor, resetExpandedEditorState, shouldHostCloseOnEscape } from "./expandedEditorState.ts";

beforeEach(() => {
  resetExpandedEditorState();
});

describe("isExpandedEditorOpen", () => {
  test("is closed until an editor opens, and closed again once it unmounts", () => {
    expect(isExpandedEditorOpen()).toBe(false);
    openExpandedEditor();
    expect(isExpandedEditorOpen()).toBe(true);
    closeExpandedEditor();
    expect(isExpandedEditorOpen()).toBe(false);
  });

  test("an unmount cannot zero out a newer editor", () => {
    // React can mount the replacement before unmounting the one it replaced
    // (and StrictMode deliberately does mount/unmount/mount). A boolean would
    // read as closed after the stale unmount while an editor is visibly open,
    // handing Escape back to the host dialog.
    openExpandedEditor(); // editor A mounts
    openExpandedEditor(); // editor B mounts
    closeExpandedEditor(); // editor A unmounts
    expect(isExpandedEditorOpen()).toBe(true);
    closeExpandedEditor(); // editor B unmounts
    expect(isExpandedEditorOpen()).toBe(false);
  });

  test("an unbalanced close cannot drive the counter negative", () => {
    closeExpandedEditor();
    closeExpandedEditor();
    expect(isExpandedEditorOpen()).toBe(false);
    openExpandedEditor();
    expect(isExpandedEditorOpen()).toBe(true);
  });
});

describe("shouldHostCloseOnEscape", () => {
  test("hosts close on Escape when no expanded editor is open", () => {
    expect(shouldHostCloseOnEscape({ key: "Escape" })).toBe(true);
  });

  test("hosts stand down on Escape while an expanded editor is open", () => {
    openExpandedEditor();
    expect(shouldHostCloseOnEscape({ key: "Escape" })).toBe(false);
    // ...and take Escape back once the editor collapses, so the discard guard
    // still runs for the dialog itself.
    closeExpandedEditor();
    expect(shouldHostCloseOnEscape({ key: "Escape" })).toBe(true);
  });

  test("ignores every other key, expanded or not", () => {
    for (const key of ["Enter", "Tab", "escape", "Esc", "a"]) {
      expect(shouldHostCloseOnEscape({ key })).toBe(false);
    }
    openExpandedEditor();
    expect(shouldHostCloseOnEscape({ key: "Enter" })).toBe(false);
  });
});

// The stand-down only matters because of the order the listeners run in, and
// there is no DOM in this test env, so model the contract we depend on:
//   - capture-phase window listeners run in registration order, and the host
//     dialog registered before the overlay mounted, so the host runs first;
//   - stopPropagation does NOT stop other listeners on the same node (that
//     would need stopImmediatePropagation), so the overlay still gets its turn;
//   - stopPropagation DOES stop the bubble phase, so the global navigation
//     handler never sees the key.
// AgentDialogFrame's onClose runs the discard confirm, so "host acted" below is
// exactly "the user was asked to throw their edits away".
function dispatchEscape() {
  const acted = { host: false, overlay: false, global: false };
  let stopped = false;
  const event = { key: "Escape", stopPropagation: () => (stopped = true) };

  // Host dialog: capture, registered first.
  if (shouldHostCloseOnEscape(event)) {
    event.stopPropagation();
    acted.host = true;
  }
  // Expanded editor overlay: capture, registered second, unconditional.
  if (isExpandedEditorOpen() && event.key === "Escape") {
    event.stopPropagation();
    acted.overlay = true;
  }
  // Global navigation fallback: bubble phase, only reached if nobody stopped it.
  if (!stopped && shouldHostCloseOnEscape(event)) acted.global = true;

  return acted;
}

describe("Escape routing with the host's capture listener registered first", () => {
  test("with an expanded editor open, only the overlay collapses — the discard guard never runs", () => {
    openExpandedEditor();
    expect(dispatchEscape()).toEqual({ host: false, overlay: true, global: false });
  });

  test("with no expanded editor, the host dialog handles Escape (discard guard intact) and the global handler stays out", () => {
    expect(dispatchEscape()).toEqual({ host: true, overlay: false, global: false });
  });

  test("collapsing the editor hands Escape straight back to the host dialog", () => {
    openExpandedEditor();
    dispatchEscape();
    closeExpandedEditor();
    expect(dispatchEscape()).toEqual({ host: true, overlay: false, global: false });
  });
});
