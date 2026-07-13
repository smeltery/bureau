import { useRef } from "react";
import type { AgentInfo, Attachment } from "../../shared/types.ts";
import { send } from "../ws.ts";
import { useAppState } from "../store.tsx";
import { AttachmentChips } from "./AttachmentChips.tsx";
import { InputComposerField } from "./input/InputComposerField.tsx";
import { MobileInputAction } from "./MobileInputAction.tsx";
import { VoiceInputControl } from "./VoiceInputControl.tsx";
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
      <AttachmentChips stagedAttachments={stagedAttachments} isMobile={isMobile} removeStaged={removeStaged} />
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
        <InputComposerField
          agentId={agent.id}
          autoResize={autoResize}
          commandDescriptions={commandDescriptions}
          editingLogEntryId={editingLogEntryId}
          filteredCommands={filteredCommands}
          handlePaste={handlePaste}
          handleSend={handleSend}
          input={input}
          isBusy={isBusy}
          isMobile={isMobile}
          partial={partial}
          selectedIdx={selectedIdx}
          setInput={setInput}
          setSelectedIdx={setSelectedIdx}
          showAutocomplete={showAutocomplete}
          skillOrigins={skillOrigins}
          textareaRef={textareaRef}
        />
        <VoiceInputControl
          isListening={isListening}
          startListening={startListening}
          stopListening={stopListening}
          showMicHint={showMicHint}
          setShowMicHint={setShowMicHint}
          speechApiPresent={speechApiPresent}
          isSecureContext={isSecureContext}
        />
        {isMobile && (
          <MobileInputAction
            agentId={agent.id}
            input={input}
            validAttachmentCount={validAttachments.length}
            hasUploading={hasUploading}
            editingLogEntryId={editingLogEntryId}
            isBusy={isBusy}
            onSend={handleSend}
          />
        )}
      </div>
    </div>
  );
}
