import { useCallback, useEffect, useState, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { shortenCwd } from "../../cwd-display.ts";
import type { CiteSelection } from "../useSelectionCite.ts";

export type EditorCite = CiteSelection & { title: string };

export function editorCiteTitle(path: string, fromLine: number, toLine: number): string {
  return `${shortenCwd(path)}:${fromLine === toLine ? fromLine : `${fromLine}-${toLine}`}`;
}

// CodeMirror draws its own selection, so the DOM selection the chat's cite
// tracker listens to is not reliable here; read the editor state on pointer
// and keyboard release instead.
export function useEditorSelectionCite(viewRef: RefObject<EditorView | null>, containerRef: RefObject<HTMLDivElement | null>, path: string | null, enabled: boolean) {
  const [cite, setCite] = useState<EditorCite | null>(null);
  const clearCite = useCallback(() => setCite(null), []);

  useEffect(() => {
    const container = containerRef.current;
    setCite(null);
    if (!enabled || !container || !path) return;
    const read = () => {
      const view = viewRef.current;
      const range = view?.state.selection.main;
      if (!view || !range || range.empty) return setCite(null);
      const coords = view.coordsAtPos(range.head);
      if (!coords) return setCite(null);
      const doc = view.state.doc;
      setCite({
        text: doc.sliceString(range.from, range.to),
        rect: new DOMRect(coords.left, coords.top, 0, coords.bottom - coords.top),
        title: editorCiteTitle(path, doc.lineAt(range.from).number, doc.lineAt(range.to).number),
      });
    };
    const onRelease = () => requestAnimationFrame(read);
    container.addEventListener("mouseup", onRelease);
    container.addEventListener("keyup", onRelease);
    container.addEventListener("scroll", clearCite, true);
    return () => {
      container.removeEventListener("mouseup", onRelease);
      container.removeEventListener("keyup", onRelease);
      container.removeEventListener("scroll", clearCite, true);
    };
  }, [viewRef, containerRef, path, enabled, clearCite]);

  return { cite, clearCite };
}
