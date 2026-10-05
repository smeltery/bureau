import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { send, addRawListener, removeRawListener } from "../ws.ts";
import { useTheme } from "../store.tsx";
import type { ServerMessage } from "../../shared/types.ts";
import { ensureMobileTerminalStyle, MobileSoftKeyBar } from "./terminal-mobile.tsx";
import { useMobileTerminalTouch } from "./useMobileTerminalTouch.ts";
import { useTerminalSoftKeys } from "./terminal/useTerminalSoftKeys.ts";
import { DARK_TERMINAL_THEME, LIGHT_TERMINAL_THEME } from "./terminal-themes.ts";
import { TerminalHeader } from "./terminal-chrome.tsx";
import { TerminalPanelBody } from "./terminal/TerminalPanelBody.tsx";
import { installReplayGuard, type ReplayGuard } from "./terminal/terminal-replay-guard.ts";

export function resetTerminalForRespawn(terminal: Pick<Terminal, "reset">): void {
  terminal.reset();
}

export function TerminalPanel({
  agentId,
  onClose,
  autoFocus = true,
  mobile = false,
  onSendToChat,
}: {
  agentId: string;
  onClose: () => void;
  // When the panel mounts because the boss explicitly toggled it open we
  // grab keyboard focus (default). When the mount is a side-effect of an
  // agent-switch restore, the boss expects to keep typing in the chat box,
  // so the parent passes false. On mobile we never auto-focus on mount —
  // iOS gates the soft-keyboard on a user gesture, so we wait for a tap on
  // the terminal body before calling term.focus().
  autoFocus?: boolean;
  // When true, render the mobile-friendly chrome: a soft-key bar and CSS
  // overrides that make xterm's hidden helper textarea focusable enough
  // for iOS Safari to surface the keyboard.
  mobile?: boolean;
  // When set, a "Send to chat" action appears while terminal text is
  // selected and inserts the selected output into the chat draft.
  onSendToChat?: (text: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputProxyRef = useRef<HTMLTextAreaElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const replayGuardRef = useRef<ReplayGuard | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // Lets handleBodyTap query whether the just-completed touch was a scroll
  // gesture (in which case we should NOT focus the input proxy and pop the
  // keyboard). The function is set by the touch-handling effect.
  const scrollMovedRef = useRef<(() => boolean) | null>(null);
  const { mode } = useTheme();
  const [exited, setExited] = useState<number | null>(null);
  const [hasSelection, setHasSelection] = useState(false);

  // Handle server messages for this terminal
  const handleRawMessage = useCallback(
    (data: string) => {
      try {
        const msg = JSON.parse(data) as ServerMessage;
        if (msg.type === "terminal_output" && msg.agentId === agentId) {
          const term = termRef.current;
          if (!term) return;
          if (msg.replay) {
            replayGuardRef.current?.writeReplay(msg.data);
          } else {
            term.write(msg.data);
          }
        } else if (msg.type === "terminal_exit" && msg.agentId === agentId) {
          setExited(msg.exitCode);
        }
      } catch {}
    },
    [agentId],
  );

  const sendInput = useCallback(
    (data: string) => {
      send({ type: "terminal_input", agentId, data });
    },
    [agentId],
  );
  const { ctrlActive, handleSoftKey, keyboardOpen, sendModifiedInput } = useTerminalSoftKeys({ inputProxyRef, mobile, sendInput, termRef });

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current) return;
    if (mobile) ensureMobileTerminalStyle();

    const term = new Terminal({
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: mobile ? 14 : 13,
      lineHeight: 1.4,
      cursorBlink: true,
      theme: mode === "dark" ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME,
      minimumContrastRatio: 4.5,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    if (!(navigator.platform || "").includes("Mac")) {
      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown") return true;
        if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return true;
        const key = event.key.toLowerCase();
        if (key === "c" && term.hasSelection()) return false;
        if (key === "v") return false;
        return true;
      });
    }
    term.open(containerRef.current);

    // Fit and (optionally) focus after open. requestAnimationFrame so the
    // container has measurable size before fitAddon runs.
    requestAnimationFrame(() => {
      fitAddon.fit();
      if (autoFocus && !mobile) term.focus();
      send({
        type: "terminal_resize",
        agentId,
        cols: term.cols,
        rows: term.rows,
      });
      if (mobile) {
        // Trick xterm into rendering its focused cursor (block + blink) even
        // though we route input via our own proxy and the helper textarea is
        // hidden. xterm registers a real DOM "focus" listener on the
        // textarea that just sets _isFocused=true; dispatching the event
        // synthetically fires that listener regardless of display state.
        // CAUTION: depends on xterm's internal focus tracking being a pure
        // DOM-event listener — verified in @xterm/xterm 6.0.0. If a future
        // release polls document.activeElement instead, the cursor will
        // stop blinking on mobile and this needs revisiting. Tightening
        // the version pin in package.json would harden against that.
        const helper = containerRef.current?.querySelector(".xterm-helper-textarea") as HTMLTextAreaElement | null;
        helper?.dispatchEvent(new Event("focus"));
      }
    });

    term.onData((data) => {
      sendModifiedInput(data);
    });

    term.onSelectionChange(() => {
      setHasSelection(term.hasSelection());
    });

    termRef.current = term;
    fitRef.current = fitAddon;
    replayGuardRef.current = installReplayGuard(term);

    // Listen for terminal messages via raw WebSocket listener
    // (survives reconnects, avoids unnecessary React re-renders)
    addRawListener(handleRawMessage);

    // Open the PTY on the server
    send({ type: "terminal_open", agentId });

    // Resize observer
    const observer = new ResizeObserver(() => {
      fitAddon.fit();
      send({
        type: "terminal_resize",
        agentId,
        cols: term.cols,
        rows: term.rows,
      });
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      removeRawListener(handleRawMessage);
      replayGuardRef.current?.dispose();
      replayGuardRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update theme without re-creating terminal
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.theme = mode === "dark" ? DARK_TERMINAL_THEME : LIGHT_TERMINAL_THEME;
    }
  }, [mode]);

  useMobileTerminalTouch({ mobile, agentId, bodyRef, termRef, fitRef, scrollMovedRef });

  // Tap on the terminal body focuses our input proxy so the soft keyboard
  // opens. Mobile only — desktop relies on xterm's built-in click-to-focus.
  // Suppress focus when the click came from a scroll gesture: the synthetic
  // click fires after touchend even if the touch panned the buffer, and
  // popping the keyboard mid-scroll is jarring.
  const handleBodyTap = useCallback(() => {
    if (!mobile) return;
    if (scrollMovedRef.current?.()) return;
    inputProxyRef.current?.focus();
  }, [mobile]);

  const sendSelectionToChat = useCallback(() => {
    const term = termRef.current;
    const text = term?.getSelection() ?? "";
    if (text.trim()) onSendToChat?.(text);
    term?.clearSelection();
  }, [onSendToChat]);

  function handleRespawn() {
    setExited(null);
    if (termRef.current) resetTerminalForRespawn(termRef.current);
    // Close old PTY (if still around) and open a new one
    send({ type: "terminal_close", agentId });
    setTimeout(() => send({ type: "terminal_open", agentId }), 100);
  }

  return (
    <div
      className={mobile ? "bureau-mobile-term" : undefined}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        // borderLeft removed — the parent container's PanelResizer renders
        // the divider so it can be drag-targeted and hover-tinted.
        background: "var(--bg-base)",
        position: "relative",
      }}
    >
      <TerminalHeader mobile={mobile} onClose={onClose} onInterrupt={() => sendInput("\x03")} onRestart={handleRespawn} />

      {/* Terminal body. position:relative so the exit overlay anchors to the
          body bottom (above the soft-key bar) without a hard-coded offset. */}
      <TerminalPanelBody
        bodyRef={bodyRef}
        containerRef={containerRef}
        exited={exited}
        inputProxyRef={inputProxyRef}
        mobile={mobile}
        onBodyTap={handleBodyTap}
        onRespawn={handleRespawn}
        onSendInput={sendInput}
        onSendToChat={onSendToChat && hasSelection ? sendSelectionToChat : undefined}
      />

      {/* Soft-key bar (mobile only). Adds the home-indicator safe-area
          inset only when the soft keyboard is dismissed — when it's up, the
          keyboard already covers the home indicator zone, so the inset
          becomes wasted vertical space. */}
      {mobile && <MobileSoftKeyBar ctrlActive={ctrlActive} keyboardOpen={keyboardOpen} onSoftKey={handleSoftKey} />}
    </div>
  );
}
