import { useRef } from "react";
import type { AgentInfo, Attachment } from "../../shared/types.ts";
import { send } from "../ws.ts";
import { sendAbortDebounced } from "../utils/abort.ts";
import { useAppState } from "../store.tsx";
import type { StagedAttachment } from "./hooks/useAttachmentUpload.ts";

export function InputBar({
  agent,
  input,
  setInput,
  inputRef,
  textareaRef,
  autoResize,
  isBusy,
  editingLogEntryId,
  username,
  onSent,
  // Attachment props
  stagedAttachments,
  validAttachments,
  hasUploading,
  handleFileSelect,
  removeStaged,
  clearAttachments,
  handlePaste,
  draggingOver,
  // Voice props
  isListening,
  startListening,
  stopListening,
  showMicHint,
  setShowMicHint,
  speechApiPresent,
  isSecureContext,
  // Autocomplete props
  showAutocomplete,
  filteredCommands,
  skillOrigins,
  commandDescriptions,
  selectedIdx,
  setSelectedIdx,
  partial,
}: {
  agent: AgentInfo;
  input: string;
  setInput: (text: string) => void;
  inputRef: React.MutableRefObject<string>;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  autoResize: (el: HTMLTextAreaElement) => void;
  isBusy: boolean;
  editingLogEntryId: string | null;
  username: string;
  onSent: () => void;
  stagedAttachments: StagedAttachment[];
  validAttachments: StagedAttachment[];
  hasUploading: boolean;
  handleFileSelect: (files: FileList | null) => void;
  removeStaged: (id: string) => void;
  clearAttachments: () => void;
  handlePaste: (e: React.ClipboardEvent) => void;
  draggingOver: boolean;
  isListening: boolean;
  startListening: () => void;
  stopListening: () => void;
  showMicHint: boolean;
  setShowMicHint: (v: boolean | ((prev: boolean) => boolean)) => void;
  speechApiPresent: boolean;
  isSecureContext: boolean;
  showAutocomplete: boolean;
  filteredCommands: string[];
  skillOrigins: Map<string, string>;
  commandDescriptions: Map<string, string>;
  selectedIdx: number;
  setSelectedIdx: (v: number | ((prev: number) => number)) => void;
  partial: string;
}) {
  const { isMobile } = useAppState();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleSend() {
    const text = input.trim();
    if (!text && validAttachments.length === 0) return;
    if (isBusy || hasUploading || editingLogEntryId) return;
    const attachments = validAttachments.length > 0 ? validAttachments.map(({ id: _id, uploading: _u, error: _e, ...att }) => att as Attachment) : undefined;
    send({ type: "send_message", agentId: agent.id, text, username, attachments });
    setInput("");
    clearAttachments();
    stopListening();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
    onSent();
  }

  return (
    <div
      style={{
        flexShrink: 0,
        padding: isMobile ? "10px 12px 10px 11px" : "10px 24px 10px 11px",
        paddingBottom: isMobile ? "calc(10px + env(safe-area-inset-bottom, 0px))" : undefined,
        borderTop: draggingOver ? "2px solid var(--green)" : "2px solid var(--border-strong)",
        background: draggingOver ? "var(--bg-hover)" : "var(--bg-surface)",
        transition: "background 0.15s, border-color 0.15s",
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          handleFileSelect(e.target.files);
          // Reset file input so the same file can be re-selected
          if (fileInputRef.current) fileInputRef.current.value = "";
        }}
      />
      {stagedAttachments.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {stagedAttachments.map((att) => (
            <div
              key={att.id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "4px 8px",
                borderRadius: 6,
                background: att.error ? "var(--red-bg)" : "var(--bg-hover)",
                border: `1px solid ${att.error ? "var(--red)" : "var(--border)"}`,
                fontSize: isMobile ? 13 : 11,
                fontFamily: "'JetBrains Mono',monospace",
                color: att.error ? "var(--red)" : "var(--text-secondary)",
                maxWidth: "100%",
              }}
            >
              {att.mediaType.startsWith("image/") ? "🖼️" : att.mediaType === "application/pdf" ? "📄" : "📎"}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>{att.originalName}</span>
              {att.uploading && <span style={{ color: "var(--text-ghost)" }}>uploading…</span>}
              {att.error && <span style={{ fontSize: isMobile ? 11 : 9 }}>{att.error}</span>}
              <button
                onClick={() => removeStaged(att.id)}
                style={{
                  background: "none",
                  border: "none",
                  color: att.error ? "var(--red)" : "var(--text-ghost)",
                  cursor: "pointer",
                  padding: "0 2px",
                  fontSize: 14,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isBusy}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            color: isBusy ? "var(--text-ghost)" : "var(--text-muted)",
            cursor: isBusy ? "default" : "pointer",
            lineHeight: "20px",
            fontSize: 16,
            flexShrink: 0,
            opacity: isBusy ? 0.4 : 0.7,
            transition: "opacity 0.15s",
          }}
          title="Attach files"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <span style={{ color: isBusy ? "var(--text-ghost)" : "var(--green)", fontWeight: 600, lineHeight: "20px", position: "relative", top: -2 }}>&#10095;</span>
        <div style={{ flex: 1, position: "relative", top: -2 }}>
          {showAutocomplete && filteredCommands.length > 0 && (
            <div
              style={{
                position: "absolute",
                bottom: "100%",
                left: 0,
                right: 0,
                marginBottom: 4,
                background: "var(--bg-surface)",
                border: "1px solid var(--border-medium)",
                borderRadius: 8,
                maxHeight: 200,
                overflowY: "auto",
                boxShadow: "0 -4px 16px rgba(0,0,0,0.3)",
                zIndex: 10,
              }}
            >
              {filteredCommands.map((cmd, i) => {
                const originLabel = skillOrigins.get(cmd);
                const desc = commandDescriptions.get(cmd);
                return (
                  <div
                    key={cmd}
                    ref={i === selectedIdx ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      setInput(`/${cmd} `);
                      textareaRef.current?.focus();
                    }}
                    onMouseEnter={() => setSelectedIdx(i)}
                    style={{
                      padding: "6px 12px",
                      cursor: "pointer",
                      background: i === selectedIdx ? "var(--bg-subtle)" : "transparent",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        color: "var(--green)",
                        fontFamily: "'JetBrains Mono',monospace",
                        fontSize: 13,
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      /{cmd}
                    </span>
                    {originLabel && (
                      <span
                        style={{
                          fontSize: 10,
                          color: "var(--text-ghost)",
                          background: "var(--bg-base)",
                          padding: "1px 6px",
                          borderRadius: 4,
                          flexShrink: 0,
                        }}
                      >
                        {originLabel}
                      </span>
                    )}
                    {desc && (
                      <span
                        style={{
                          fontSize: 11,
                          color: "var(--text-ghost)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {desc}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={input}
            onPaste={handlePaste}
            onChange={(e) => {
              setInput(e.target.value);
              autoResize(e.target);
            }}
            onKeyDown={(e) => {
              // While an OS IME is composing (CJK / accent input), let the
              // composition consume Enter and other keys instead of sending.
              if (e.nativeEvent.isComposing) return;
              // Autocomplete navigation
              if (showAutocomplete && filteredCommands.length > 0) {
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setSelectedIdx((prev) => (prev > 0 ? prev - 1 : filteredCommands.length - 1));
                  return;
                }
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setSelectedIdx((prev) => (prev < filteredCommands.length - 1 ? prev + 1 : 0));
                  return;
                }
                if (e.key === "Tab") {
                  e.preventDefault();
                  const selected = filteredCommands[selectedIdx];
                  if (selected) {
                    setInput(`/${selected} `);
                  }
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  const selected = filteredCommands[selectedIdx];
                  // If exact match, send it; otherwise autocomplete
                  if (selected && partial === selected.toLowerCase()) {
                    // Exact match — fall through to send
                  } else if (selected) {
                    e.preventDefault();
                    setInput(`/${selected} `);
                    return;
                  }
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setInput("");
                  return;
                }
              }
              if (e.key === "Enter" && !e.shiftKey && !isMobile) {
                e.preventDefault();
                handleSend();
              }
              if (e.key === "c" && (e.ctrlKey || e.metaKey) && isBusy) {
                e.preventDefault();
                sendAbortDebounced(agent.id);
              }
            }}
            placeholder={
              editingLogEntryId
                ? "Editing message above..."
                : isBusy
                  ? isMobile
                    ? "Agent is busy..."
                    : "Agent is busy — Ctrl+C to interrupt..."
                  : isMobile
                    ? "Type a message..."
                    : "Type a message or / for commands..."
            }
            autoFocus={!isMobile}
            rows={1}
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              outline: "none",
              color: isBusy || editingLogEntryId ? "var(--text-muted)" : "var(--text-secondary)",
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
        {speechApiPresent && isSecureContext ? (
          <button
            onMouseDown={startListening}
            onMouseUp={stopListening}
            onMouseLeave={stopListening}
            onTouchStart={startListening}
            onTouchEnd={stopListening}
            style={{
              flexShrink: 0,
              width: 36,
              height: 36,
              marginTop: -9,
              borderRadius: 6,
              border: isListening ? "1px solid var(--red)" : "1px solid var(--border)",
              background: isListening ? "rgba(255,50,50,0.15)" : "transparent",
              color: isListening ? "var(--red)" : "var(--text-muted)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              transition: "all 0.15s",
              animation: isListening ? "mic-pulse 1.5s ease-in-out infinite" : "none",
              userSelect: "none",
              WebkitUserSelect: "none",
            }}
            title="Hold to talk (Ctrl+Space)"
          >
            <MicIcon />
          </button>
        ) : speechApiPresent && !isSecureContext ? (
          <div style={{ position: "relative", flexShrink: 0 }}>
            <button
              onClick={() => setShowMicHint((v) => !v)}
              style={{
                width: 36,
                height: 36,
                marginTop: -9,
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text-muted)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
                opacity: 0.4,
              }}
              title="Voice input requires HTTPS"
            >
              <MicIcon />
            </button>
            {showMicHint && <MicHint onClose={() => setShowMicHint(false)} />}
          </div>
        ) : null}
        {isMobile &&
          (isBusy ? (
            <button
              onClick={() => sendAbortDebounced(agent.id)}
              style={{
                flexShrink: 0,
                alignSelf: "flex-end",
                width: 36,
                height: 36,
                borderRadius: 8,
                border: "1px solid var(--red)",
                background: "transparent",
                color: "var(--red)",
                fontSize: 16,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                lineHeight: 1,
              }}
              title="Abort"
            >
              ■
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={(!input.trim() && validAttachments.length === 0) || hasUploading || !!editingLogEntryId}
              style={{
                flexShrink: 0,
                alignSelf: "flex-end",
                width: 36,
                height: 36,
                borderRadius: 8,
                border: "none",
                background: (input.trim() || validAttachments.length > 0) && !hasUploading && !editingLogEntryId ? "var(--green)" : "var(--bg-hover)",
                color: (input.trim() || validAttachments.length > 0) && !hasUploading && !editingLogEntryId ? "var(--bg-base)" : "var(--text-ghost)",
                fontSize: 16,
                cursor: (input.trim() || validAttachments.length > 0) && !hasUploading && !editingLogEntryId ? "pointer" : "default",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                lineHeight: 1,
                transition: "background 0.15s, color 0.15s",
              }}
              title="Send"
            >
              ▲
            </button>
          ))}
      </div>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="1" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

function MicHint({ onClose }: { onClose: () => void }) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: "calc(100% + 8px)",
        right: 0,
        width: 320,
        background: "var(--bg-surface)",
        border: "1px solid var(--border-medium)",
        borderRadius: 8,
        padding: "12px 14px",
        fontSize: 12,
        color: "var(--text-secondary)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        zIndex: 20,
        animation: "fadeIn 0.1s ease-out",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8, color: "var(--text-primary)" }}>Voice input requires HTTPS</div>
      <div style={{ marginBottom: 8, lineHeight: 1.5 }}>
        Enable HTTPS in your <span style={{ color: "var(--text-primary)" }}>Tailscale admin console</span> (DNS page), then run these on the host (use the built-in terminal):
      </div>
      <code
        style={{
          display: "block",
          background: "var(--bg-base)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: "8px 10px",
          fontSize: 11,
          fontFamily: "'JetBrains Mono',monospace",
          color: "var(--text-secondary)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          lineHeight: 1.6,
        }}
      >
        {`sudo tailscale set --operator=$USER\ntailscale serve --bg http://localhost:4000`}
      </code>
      <div style={{ marginTop: 8, lineHeight: 1.5, color: "var(--text-muted)" }}>Restart bureau and reload this page. You'll be auto-redirected to HTTPS.</div>
      <button
        onClick={onClose}
        style={{
          position: "absolute",
          top: 8,
          right: 10,
          background: "none",
          border: "none",
          color: "var(--text-ghost)",
          cursor: "pointer",
          fontSize: 14,
          padding: 0,
        }}
      >
        &times;
      </button>
    </div>
  );
}
