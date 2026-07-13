import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { send, addRawListener, removeRawListener } from "../ws.ts";
import { useTheme } from "../store.tsx";
import type { ServerMessage } from "../../shared/types.ts";
import { applyCtrl, ensureMobileTerminalStyle, MobileSoftKeyBar, type SoftKey } from "./terminal-mobile.tsx";
import { useMobileTerminalTouch } from "./useMobileTerminalTouch.ts";
import { useMobileKeyboardOpen } from "./terminal/useMobileKeyboardOpen.ts";
import { DARK_TERMINAL_THEME, LIGHT_TERMINAL_THEME } from "./terminal-themes.ts";
import { TerminalHeader } from "./terminal-chrome.tsx";
import { TerminalPanelBody } from "./terminal/TerminalPanelBody.tsx";

export function TerminalPanel({
  agentId,
  onClose,
  autoFocus = true,
  mobile = false,
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
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputProxyRef = useRef<HTMLTextAreaElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  // Lets handleBodyTap query whether the just-completed touch was a scroll
  // gesture (in which case we should NOT focus the input proxy and pop the
  // keyboard). The function is set by the touch-handling effect.
  const scrollMovedRef = useRef<(() => boolean) | null>(null);
  const { mode } = useTheme();
  const [exited, setExited] = useState<number | null>(null);
  const [ctrlActive, setCtrlActive] = useState(false);
  const ctrlActiveRef = useRef(false);
  const keyboardOpen = useMobileKeyboardOpen(mobile);
  // Wrap the state setter so the ref stays in sync without a render-time
  // write. sendInput / handleSoftKey both read the ref synchronously inside
  // event handlers, so it must lead the React render.
  const setCtrl = useCallback((v: boolean) => {
    ctrlActiveRef.current = v;
    setCtrlActive(v);
  }, []);

  // Handle server messages for this terminal
  const handleRawMessage = useCallback(
    (data: string) => {
      try {
        const msg = JSON.parse(data) as ServerMessage;
        if (msg.type === "terminal_output" && msg.agentId === agentId) {
          termRef.current?.write(msg.data);
        } else if (msg.type === "terminal_exit" && msg.agentId === agentId) {
          setExited(msg.exitCode);
        }
      } catch {}
    },
    [agentId],
  );

  // Send keystrokes to the PTY, applying the sticky Ctrl modifier if armed.
  const sendInput = useCallback(
    (data: string) => {
      let toSend = data;
      if (ctrlActiveRef.current) {
        toSend = applyCtrl(data);
        setCtrl(false);
      }
      send({ type: "terminal_input", agentId, data: toSend });
    },
    [agentId, setCtrl],
  );

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
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
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
      sendInput(data);
    });

    termRef.current = term;
    fitRef.current = fitAddon;

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

  function handleRespawn() {
    setExited(null);
    termRef.current?.clear();
    // Close old PTY (if still around) and open a new one
    send({ type: "terminal_close", agentId });
    setTimeout(() => send({ type: "terminal_open", agentId }), 100);
  }

  async function doPaste() {
    // Try the async Clipboard API first. Requires a secure context, so on
    // plain-HTTP tailnet access (the common case here) it'll usually reject
    // and we fall back to window.prompt, where the user long-presses to
    // paste from the iOS/Android system paste menu. term.paste handles
    // bracketed-paste wrapping based on whether the shell enabled it.
    let text = "";
    try {
      if (navigator.clipboard?.readText) {
        text = await navigator.clipboard.readText();
      }
    } catch {}
    if (!text) {
      const fromPrompt = window.prompt("Paste:");
      if (fromPrompt) text = fromPrompt;
    }
    if (text) termRef.current?.paste(text);
    inputProxyRef.current?.focus();
  }

  function handleSoftKey(key: SoftKey) {
    if (key.toggleCtrl) {
      setCtrl(!ctrlActiveRef.current);
      // Re-focus the proxy so the next typed key from the on-screen keyboard
      // is still captured.
      inputProxyRef.current?.focus();
      return;
    }
    if (key.action === "paste") {
      void doPaste();
      return;
    }
    if (key.arrow) {
      // Arrow keys honor the Ctrl modifier (for word-jump in shells).
      sendInput(key.arrow);
    } else if (key.data !== undefined) {
      sendInput(key.data);
    }
    inputProxyRef.current?.focus();
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
      <TerminalHeader mobile={mobile} onClose={onClose} />

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
      />

      {/* Soft-key bar (mobile only). Adds the home-indicator safe-area
          inset only when the soft keyboard is dismissed — when it's up, the
          keyboard already covers the home indicator zone, so the inset
          becomes wasted vertical space. */}
      {mobile && <MobileSoftKeyBar ctrlActive={ctrlActive} keyboardOpen={keyboardOpen} onSoftKey={handleSoftKey} />}
    </div>
  );
}
