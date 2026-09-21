import type { ClipboardEvent, RefObject } from "react";
import { sendAbortDebounced } from "../../utils/abort.ts";
import { InputAutocomplete } from "../InputAutocomplete.tsx";

export function isSendNowShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, isMobile: boolean): boolean {
  return !isMobile && event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.shiftKey;
}

export function completedSlashCommandDraft(input: string, name: string): { text: string; caret: number } {
  const command = `/${name}`;
  const tokenEnd = input.search(/\s/);
  const suffix = tokenEnd < 0 ? "" : input.slice(tokenEnd);
  const text = command + (suffix || " ");
  return { text, caret: command.length + (suffix ? 0 : 1) };
}

export function InputComposerField({
  agentId,
  autoResize,
  commandDescriptions,
  editingLogEntryId,
  filteredCommands,
  handlePaste,
  handleSend,
  input,
  isBusy,
  isMobile,
  partial,
  selectedIdx,
  setInput,
  setSelectedIdx,
  showAutocomplete,
  skillOrigins,
  textareaRef,
}: {
  agentId: string;
  autoResize: (el: HTMLTextAreaElement) => void;
  commandDescriptions: Map<string, string>;
  editingLogEntryId: string | null;
  filteredCommands: string[];
  handlePaste: (e: ClipboardEvent) => void;
  handleSend: (opts?: { sendNow?: boolean }) => void;
  input: string;
  isBusy: boolean;
  isMobile: boolean;
  partial: string;
  selectedIdx: number;
  setInput: (text: string) => void;
  setSelectedIdx: (v: number | ((prev: number) => number)) => void;
  showAutocomplete: boolean;
  skillOrigins: Map<string, string>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}) {
  function completeCommand(name: string) {
    const completed = completedSlashCommandDraft(input, name);
    setInput(completed.text);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(completed.caret, completed.caret);
      autoResize(textarea);
    });
  }

  return (
    <div style={{ flex: 1, position: "relative", top: -2 }}>
      {showAutocomplete && filteredCommands.length > 0 && (
        <InputAutocomplete
          filteredCommands={filteredCommands}
          skillOrigins={skillOrigins}
          commandDescriptions={commandDescriptions}
          selectedIdx={selectedIdx}
          setSelectedIdx={setSelectedIdx}
          completeCommand={completeCommand}
          textareaRef={textareaRef}
        />
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
                completeCommand(selected);
              }
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              const selected = filteredCommands[selectedIdx];
              if (selected && partial === selected.toLowerCase()) {
                // Exact match: fall through to send.
              } else if (selected) {
                e.preventDefault();
                completeCommand(selected);
                return;
              }
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setInput("");
              return;
            }
          }
          if (isSendNowShortcut(e, isMobile)) {
            e.preventDefault();
            handleSend({ sendNow: true });
            return;
          }
          if (e.key === "Enter" && !e.shiftKey && !isMobile) {
            e.preventDefault();
            handleSend();
          }
          if (e.key === "c" && (e.ctrlKey || e.metaKey) && isBusy) {
            e.preventDefault();
            sendAbortDebounced(agentId);
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
  );
}
