import type { RefObject } from "react";
import { MobileInputProxy } from "../terminal-mobile.tsx";
import { TerminalExitOverlay } from "../terminal-chrome.tsx";

export function TerminalPanelBody({
  bodyRef,
  containerRef,
  exited,
  inputProxyRef,
  mobile,
  onBodyTap,
  onRespawn,
  onSendToChat,
  onSendInput,
}: {
  bodyRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  exited: number | null;
  inputProxyRef: RefObject<HTMLTextAreaElement | null>;
  mobile: boolean;
  onBodyTap: () => void;
  onRespawn: () => void;
  onSendToChat?: () => void;
  onSendInput: (data: string) => void;
}) {
  return (
    <div
      ref={bodyRef}
      className={mobile ? "bureau-mobile-term-body" : undefined}
      onClick={onBodyTap}
      style={{
        flex: 1,
        minHeight: 0,
        padding: 4,
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      {mobile && <MobileInputProxy ref={inputProxyRef} onInput={onSendInput} />}
      {onSendToChat && (
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onSendToChat();
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.detail === 0) onSendToChat();
          }}
          title="Insert selected terminal output into the chat input"
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            padding: "5px 9px",
            borderRadius: 6,
            border: "1px solid var(--border-medium)",
            background: "var(--bg-surface)",
            color: "var(--text-secondary)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 600,
            userSelect: "none",
            WebkitUserSelect: "none",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          Send to chat
        </button>
      )}
      {exited !== null && <TerminalExitOverlay exitCode={exited} onRestart={onRespawn} />}
    </div>
  );
}
