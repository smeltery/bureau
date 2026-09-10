import type { RefObject } from "react";
import type { CronjobRunStatus } from "../../shared/types.ts";
import { StatusShape } from "../icons/StatusShape.tsx";

export function CronjobRunComposer({
  canResume,
  editingLogEntryId,
  input,
  isMobile,
  isRunning,
  runStatus,
  textareaRef,
  onInputChange,
  onSend,
}: {
  canResume: boolean;
  editingLogEntryId: string | null;
  input: string;
  isMobile: boolean;
  isRunning: boolean;
  runStatus: CronjobRunStatus | null;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onInputChange: (value: string, textarea: HTMLTextAreaElement) => void;
  onSend: () => void;
}) {
  if (!canResume) {
    return (
      <div
        style={{
          padding: "10px 16px",
          borderTop: "1px solid var(--border-subtle)",
          background: "var(--bg-surface)",
          fontSize: 11,
          color: "var(--text-muted)",
          textAlign: "center",
        }}
      >
        {isRunning
          ? "Run in progress - wait for it to finish before sending a follow-up."
          : runStatus === "skipped"
            ? "Skipped runs have no session to resume."
            : "This run can't be resumed (no session was established)."}
      </div>
    );
  }

  const canSend = !!input.trim() && !editingLogEntryId;

  return (
    <div
      style={{
        flexShrink: 0,
        padding: isMobile ? "10px 12px 10px 11px" : "10px 24px 10px 11px",
        paddingBottom: isMobile ? "calc(10px + env(safe-area-inset-bottom, 0px))" : undefined,
        borderTop: "2px solid var(--border-strong)",
        background: "var(--bg-surface)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span style={{ color: "var(--green)", fontWeight: 600, lineHeight: "20px", position: "relative", top: -2 }}>&#10095;</span>
        <div style={{ flex: 1, position: "relative", top: -2 }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value, e.target)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !isMobile && !e.nativeEvent.isComposing) {
                e.preventDefault();
                onSend();
              }
            }}
            placeholder={editingLogEntryId ? "Editing message above..." : "Send a follow-up"}
            autoFocus={!isMobile}
            rows={1}
            disabled={!!editingLogEntryId}
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              outline: "none",
              color: editingLogEntryId ? "var(--text-muted)" : "var(--text-secondary)",
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: isMobile ? 16 : 13,
              caretColor: "var(--green)",
              resize: "none",
              padding: "0 0 4px",
              lineHeight: "20px",
              maxHeight: 200,
              overflowY: "auto",
            }}
          />
        </div>
        {isMobile && (
          <button
            onClick={onSend}
            disabled={!canSend}
            style={{
              flexShrink: 0,
              alignSelf: "flex-end",
              width: 36,
              height: 36,
              borderRadius: 8,
              border: "none",
              background: canSend ? "var(--green)" : "var(--bg-hover)",
              color: canSend ? "var(--bg-base)" : "var(--text-ghost)",
              fontSize: 16,
              cursor: canSend ? "pointer" : "default",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              lineHeight: 1,
            }}
            title="Send"
          >
            <StatusShape kind="triangle" rotate={-90} />
          </button>
        )}
      </div>
    </div>
  );
}
