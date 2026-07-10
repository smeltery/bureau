import { useCallback, useEffect, useRef, useState } from "react";

export const PANEL_MIN = { terminal: 300, editor: 380 } as const;

// Side panel size constraints. Editor has a higher max than terminal so the
// tab strip + line numbers don't squeeze content into a useless column.
const PANEL_MAX = { terminal: 1000, editor: 1200 } as const;
// The chat column always keeps at least this many pixels regardless of how far
// the boss drags the panel.
const CHAT_COLUMN_FLOOR = 300;

function readPanelWidth(kind: "terminal" | "editor", fallback: number): number {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(`bureau:panel-width:${kind}`);
    if (raw === null) return fallback;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.max(PANEL_MIN[kind], Math.min(PANEL_MAX[kind], n));
  } catch {
    return fallback;
  }
}

function writePanelWidth(kind: "terminal" | "editor", width: number): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(`bureau:panel-width:${kind}`, String(Math.round(width)));
  } catch {}
}

export function useSidePanelLayout() {
  // Side panel widths (persisted to localStorage per kind). Read at mount,
  // clamped on window resize so a shrinking browser can't push the chat column
  // below CHAT_COLUMN_FLOOR.
  const [terminalWidth, setTerminalWidth] = useState<number>(() => readPanelWidth("terminal", 500));
  const [editorWidth, setEditorWidth] = useState<number>(() => readPanelWidth("editor", 600));
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const commitTerminalWidth = useCallback((width: number) => {
    setTerminalWidth(width);
    writePanelWidth("terminal", width);
  }, []);
  const commitEditorWidth = useCallback((width: number) => {
    setEditorWidth(width);
    writePanelWidth("editor", width);
  }, []);
  const getTerminalMax = useCallback(() => {
    return Math.max(PANEL_MIN.terminal, Math.min(PANEL_MAX.terminal, window.innerWidth - CHAT_COLUMN_FLOOR));
  }, []);
  const getEditorMax = useCallback(() => {
    return Math.max(PANEL_MIN.editor, Math.min(PANEL_MAX.editor, window.innerWidth - CHAT_COLUMN_FLOOR));
  }, []);
  useEffect(() => {
    function clamp() {
      const maxAllowedTerminal = Math.max(PANEL_MIN.terminal, window.innerWidth - CHAT_COLUMN_FLOOR);
      setTerminalWidth((width) => (width > maxAllowedTerminal ? maxAllowedTerminal : width));
      const maxAllowedEditor = Math.max(PANEL_MIN.editor, window.innerWidth - CHAT_COLUMN_FLOOR);
      setEditorWidth((width) => (width > maxAllowedEditor ? maxAllowedEditor : width));
    }
    window.addEventListener("resize", clamp);
    clamp();
    return () => window.removeEventListener("resize", clamp);
  }, []);

  return {
    terminalWidth,
    editorWidth,
    terminalContainerRef,
    editorContainerRef,
    commitTerminalWidth,
    commitEditorWidth,
    getTerminalMax,
    getEditorMax,
  };
}
