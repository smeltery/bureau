import { useCallback, useState } from "react";
import { useAppState, useDispatch } from "../../store.tsx";
import { send } from "../../ws.ts";
import { useSidePanelLayout } from "./useSidePanelLayout.ts";
import { commandInputBytes } from "../terminal/terminal-command.ts";

export function useLogViewPanels(agentId: string) {
  const { sidePanels } = useAppState();
  const dispatch = useDispatch();
  const sidePanel = sidePanels.get(agentId) ?? null;
  const terminalOpen = sidePanel === "terminal";
  const editorOpen = sidePanel === "editor";
  const browserOpen = sidePanel === "browser";
  const [editorInitialPath, setEditorInitialPath] = useState<string | null>(null);
  const { terminalWidth, editorWidth, terminalContainerRef, editorContainerRef, commitTerminalWidth, commitEditorWidth, getTerminalMax, getEditorMax } = useSidePanelLayout();

  const setTerminalOpen = useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      const prev = sidePanels.get(agentId) === "terminal";
      const next = typeof value === "function" ? value(prev) : value;
      dispatch({ type: "set_side_panel", agentId, panel: next ? "terminal" : null });
    },
    [dispatch, agentId, sidePanels],
  );

  const setEditorOpen = useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      const prev = sidePanels.get(agentId) === "editor";
      const next = typeof value === "function" ? value(prev) : value;
      dispatch({ type: "set_side_panel", agentId, panel: next ? "editor" : null });
    },
    [dispatch, agentId, sidePanels],
  );

  const setBrowserOpen = useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      const prev = sidePanels.get(agentId) === "browser";
      const next = typeof value === "function" ? value(prev) : value;
      dispatch({ type: "set_side_panel", agentId, panel: next ? "browser" : null });
    },
    [dispatch, agentId, sidePanels],
  );

  const openInEditor = useCallback(
    (path: string) => {
      setEditorInitialPath(path);
      dispatch({ type: "set_side_panel", agentId, panel: "editor" });
    },
    [dispatch, agentId],
  );

  // Open the terminal panel and prefill the command at the prompt without
  // executing it. The delay covers panel mount, terminal_open, PTY spawn, and
  // first prompt sequencing; if the panel was already open there is no delay.
  const copyToTerminal = useCallback(
    (command: string) => {
      const wasOpen = sidePanels.get(agentId) === "terminal";
      dispatch({ type: "set_side_panel", agentId, panel: "terminal" });
      const delay = wasOpen ? 0 : 250;
      setTimeout(() => {
        send({ type: "terminal_input", agentId, data: commandInputBytes(command) });
        const helper = (terminalContainerRef.current ?? document).querySelector(".xterm-helper-textarea") as HTMLTextAreaElement | null;
        helper?.focus();
      }, delay);
    },
    [dispatch, agentId, sidePanels, terminalContainerRef],
  );

  return {
    terminalOpen,
    editorOpen,
    browserOpen,
    setTerminalOpen,
    setEditorOpen,
    setBrowserOpen,
    editorInitialPath,
    clearEditorInitialPath: () => setEditorInitialPath(null),
    openInEditor,
    copyToTerminal,
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
