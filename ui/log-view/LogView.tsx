import { useCallback, useEffect, useMemo, useRef, useState, type RefCallback } from "react";
import type { AgentInfo, LogEntry } from "../../shared/types.ts";
import { send } from "../ws.ts";
import { useAppState, useDispatch, useFeatures } from "../store.tsx";
import { useSwipeLeftRight } from "../hooks/useSwipeLeftRight.ts";
import { serializeEntries } from "./entries/index.tsx";
import { TerminalPanel } from "./TerminalPanel.tsx";
import { EditorPanel } from "./EditorPanel.tsx";
import { PanelResizer } from "./PanelResizer.tsx";
import { Header } from "./Header.tsx";
import { InputBar } from "./InputBar.tsx";
import { QueueChips } from "./QueueChips.tsx";
import { useViewportHeight } from "./hooks/useViewportHeight.ts";
import { useAutoScroll } from "./hooks/useAutoScroll.ts";
import { usePinnedUserMessage } from "./hooks/usePinnedUserMessage.ts";
import { useSlashAutocomplete } from "./hooks/useSlashAutocomplete.ts";
import { useVoiceInput } from "./hooks/useVoiceInput.ts";
import { useAttachmentUpload } from "./hooks/useAttachmentUpload.ts";
import { PANEL_MIN, useSidePanelLayout } from "./hooks/useSidePanelLayout.ts";
import { useSelectionCite } from "./useSelectionCite.ts";
import { CiteSelectionButton } from "./CiteSelectionButton.tsx";
import { LogMessagesPane } from "./LogMessagesPane.tsx";

export function LogView({
  agent,
  logs,
  onBack,
  onEditAgent,
  username,
  onOpenTasks,
  onSwipeLeft,
  onSwipeRight,
}: {
  agent: AgentInfo;
  logs: LogEntry[];
  onBack: () => void;
  onEditAgent: () => void;
  username: string;
  onOpenTasks?: () => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
}) {
  const { drafts, slashCommands, stateChangedAt, isMobile, connected, sidePanels } = useAppState();
  const dispatch = useDispatch();
  const features = useFeatures();
  const sidePanel = sidePanels.get(agent.id) ?? null;
  const terminalOpen = sidePanel === "terminal";
  const editorOpen = sidePanel === "editor";
  const setTerminalOpen = useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      const prev = sidePanels.get(agent.id) === "terminal";
      const next = typeof value === "function" ? value(prev) : value;
      dispatch({ type: "set_side_panel", agentId: agent.id, panel: next ? "terminal" : null });
    },
    [dispatch, agent.id, sidePanels],
  );
  const setEditorOpen = useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      const prev = sidePanels.get(agent.id) === "editor";
      const next = typeof value === "function" ? value(prev) : value;
      dispatch({ type: "set_side_panel", agentId: agent.id, panel: next ? "editor" : null });
    },
    [dispatch, agent.id, sidePanels],
  );

  const { terminalWidth, editorWidth, terminalContainerRef, editorContainerRef, commitTerminalWidth, commitEditorWidth, getTerminalMax, getEditorMax } = useSidePanelLayout();

  // Input draft + textarea ref
  const input = drafts.get(agent.id) ?? "";
  const inputRef = useRef(input);
  inputRef.current = input;
  const setInput = useCallback((text: string) => dispatch({ type: "set_draft", agentId: agent.id, text }), [dispatch, agent.id]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoResize = useCallback((el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, []);

  // Scroll container ref + swipe-to-cycle-agent (mobile)
  const scrollRef = useRef<HTMLDivElement>(null);
  const swipeRef = useSwipeLeftRight(onSwipeLeft ?? (() => {}), onSwipeRight ?? (() => {}), isMobile);
  const messagesRef: RefCallback<HTMLDivElement> = useCallback(
    (node) => {
      (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      swipeRef(node);
    },
    [swipeRef],
  );

  // Chrome + UI state
  const [showAvatar, setShowAvatar] = useState(() => localStorage.getItem("bureau-show-avatar") !== "false");
  const toggleAvatar = useCallback(
    () =>
      setShowAvatar((prev) => {
        const next = !prev;
        localStorage.setItem("bureau-show-avatar", String(next));
        return next;
      }),
    [],
  );
  const [editingLogEntryId, setEditingLogEntryId] = useState<string | null>(null);

  // Hooks owning their own concerns
  const vpHeight = useViewportHeight(isMobile, scrollRef);
  const { autoScroll, setAutoScroll, handleScroll: handleAutoScroll } = useAutoScroll(scrollRef, logs, agent.state);
  const { pinnedMessage, scrollToPinnedMessage, getUserMsgRefCb, recomputePinned } = usePinnedUserMessage(scrollRef, logs, agent.state);

  // Cite-from-selection: when the boss highlights text in the chat log, show
  // a floating "Cite" pill that inserts the selection into the draft as a
  // triple-quoted block. Gated to pointer-fine devices for v1 — mobile
  // scroll is already finicky and the selection layer makes it worse.
  // The hook is a pure observer; the click handler below (handleCite) is
  // the only place we mutate draft / focus / selection. Scroll-hide lives
  // in handleScroll below — keeping the hook selection-only, with the
  // chat's existing scroll path owning geometry invalidation.
  const isTouchPrimary = useMemo(() => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches, []);
  const citeEnabled = !isTouchPrimary && !editingLogEntryId;
  const { cite, clearCite } = useSelectionCite(scrollRef, citeEnabled);

  const handleScroll = useCallback(() => {
    handleAutoScroll();
    recomputePinned();
    // Hide cite pill when the chat scrolls — its cached viewport rect goes
    // stale and `selectionchange` won't fire for a pure scroll.
    if (cite) clearCite();
  }, [handleAutoScroll, recomputePinned, cite, clearCite]);
  const autocomplete = useSlashAutocomplete(input, slashCommands.get(agent.id));
  const voice = useVoiceInput({
    inputRef,
    onTranscript: (text) => dispatch({ type: "set_draft", agentId: agent.id, text }),
    onGrow: () => {
      if (textareaRef.current) autoResize(textareaRef.current);
    },
  });
  const attachments = useAttachmentUpload(agent.id);

  const isBusy = agent.state === "thinking" || agent.state === "tool_executing";

  // Open the editor side panel and focus the file. Path is held in local
  // state so the editor panel can read it on mount and clear it after.
  const [editorInitialPath, setEditorInitialPath] = useState<string | null>(null);
  const openInEditor = useCallback(
    (path: string) => {
      setEditorInitialPath(path);
      dispatch({ type: "set_side_panel", agentId: agent.id, panel: "editor" });
    },
    [dispatch, agent.id],
  );

  // Open the terminal panel and prefill the command at the prompt without
  // executing it. The 250ms delay covers the panel-mount → terminal_open
  // → PTY-spawn → first-prompt sequence; if the panel was already open it
  // just adds a tiny lag before the bytes appear. WS messages are ordered
  // per-connection, so terminal_open (sent on panel mount) lands before
  // terminal_input only because of this delay — sending synchronously
  // would race ahead of mount and the bytes would hit a non-existent PTY.
  // After sending, focus xterm's helper textarea so Enter goes to the
  // shell instead of re-firing the still-focused button (which would
  // re-copy).
  const copyToTerminal = useCallback(
    (command: string) => {
      const wasOpen = sidePanels.get(agent.id) === "terminal";
      dispatch({ type: "set_side_panel", agentId: agent.id, panel: "terminal" });
      const delay = wasOpen ? 0 : 250;
      setTimeout(() => {
        send({ type: "terminal_input", agentId: agent.id, data: command });
        const helper = (terminalContainerRef.current ?? document).querySelector(".xterm-helper-textarea") as HTMLTextAreaElement | null;
        helper?.focus();
      }, delay);
    },
    [dispatch, agent.id, sidePanels],
  );

  // Dismiss edit textarea when agent is no longer idle (e.g. another tab sent a message)
  useEffect(() => {
    if (agent.state !== "waiting_for_response" && editingLogEntryId) {
      setEditingLogEntryId(null);
    }
  }, [agent.state]);

  // Auto-resize textarea and place cursor at end when draft is restored
  useEffect(() => {
    if (textareaRef.current && input) {
      autoResize(textareaRef.current);
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, []);

  // Ctrl+` to toggle terminal panel
  useEffect(() => {
    function handleTerminalShortcut(e: KeyboardEvent) {
      if (isMobile || !features.terminal) return;
      if (e.key === "`" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setTerminalOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleTerminalShortcut);
    return () => window.removeEventListener("keydown", handleTerminalShortcut);
  }, [isMobile, features.terminal]);

  const getConversationText = useCallback(() => serializeEntries(logs), [logs]);

  // Insert (or append) `text` into the draft as a triple-quoted "Cited text"
  // block, then focus the textarea + position the caret after the insertion.
  // Splits on caret-vs-no-caret because the boss might cite into a half-
  // written prompt OR with no active focus on the composer at all.
  const handleCite = useCallback(
    (text: string) => {
      const ta = textareaRef.current;
      const current = inputRef.current;
      const block = `Cited text:\n"""\n${text}\n"""\n`;

      let newDraft: string;
      let caretPos: number;

      if (ta && document.activeElement === ta) {
        const start = ta.selectionStart ?? current.length;
        const end = ta.selectionEnd ?? current.length;
        const before = current.slice(0, start);
        const after = current.slice(end);
        const leadSep = before === "" || before.endsWith("\n") ? "" : "\n";
        const trailSep = after === "" || after.startsWith("\n") ? "" : "\n";
        const insertion = leadSep + block + trailSep;
        newDraft = before + insertion + after;
        caretPos = before.length + insertion.length;
      } else {
        if (current === "") {
          newDraft = block;
        } else {
          const sep = current.endsWith("\n\n") ? "" : current.endsWith("\n") ? "\n" : "\n\n";
          newDraft = current + sep + block;
        }
        caretPos = newDraft.length;
      }

      setInput(newDraft);
      // Collapse the chat selection so the pill goes away. selectionchange
      // will null out the hook state too, but clearCite first for snappy
      // feedback.
      clearCite();
      window.getSelection()?.removeAllRanges();
      requestAnimationFrame(() => {
        const ta2 = textareaRef.current;
        if (!ta2) return;
        ta2.focus({ preventScroll: true });
        ta2.setSelectionRange(caretPos, caretPos);
        autoResize(ta2);
      });
    },
    [setInput, clearCite, autoResize],
  );

  return (
    <div
      style={{
        ...(isMobile
          ? {
              position: "fixed" as const,
              top: 0,
              left: 0,
              right: 0,
              height: vpHeight != null ? vpHeight : "calc(100dvh - var(--banner-h, 0px))",
              overflow: "hidden",
            }
          : {
              height: "calc(100vh - var(--banner-h, 0px))",
            }),
        display: "flex",
        flexDirection: "row",
        background: "var(--bg-base)",
        animation: "termEnter 0.3s ease-out",
      }}
    >
      <div
        onDragOver={attachments.handleDragOver}
        onDragEnter={attachments.handleDragEnter}
        onDragLeave={attachments.handleDragLeave}
        onDrop={attachments.handleDrop}
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
          position: "relative",
        }}
      >
        <Header
          agent={agent}
          logs={logs}
          onBack={onBack}
          onEditAgent={onEditAgent}
          onOpenTasks={onOpenTasks}
          showAvatar={showAvatar}
          toggleAvatar={toggleAvatar}
          terminalOpen={terminalOpen}
          setTerminalOpen={setTerminalOpen}
          editorOpen={editorOpen}
          setEditorOpen={setEditorOpen}
          getConversationText={getConversationText}
        />

        {/* Pinned user message — sits between the header and the messages
            when no user_message is currently visible in the scroll viewport.
            Click scrolls the conversation back to that message. */}
        {pinnedMessage && (
          <div
            onClick={scrollToPinnedMessage}
            title={pinnedMessage.content}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: isMobile ? "6px 12px" : "6px 24px",
              background: "var(--bg-subtle)",
              borderBottom: "1px solid var(--border)",
              cursor: "pointer",
              color: "var(--text-muted)",
              fontSize: 12,
              flexShrink: 0,
            }}
          >
            <span style={{ color: "var(--text-ghost)", flexShrink: 0, fontWeight: 600 }}>↑ you:</span>
            <span
              style={{
                flex: 1,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                minWidth: 0,
              }}
            >
              {pinnedMessage.content}
            </span>
            <span style={{ color: "var(--text-ghost)", flexShrink: 0, fontSize: 11, lineHeight: 1 }}>↑</span>
          </div>
        )}

        <LogMessagesPane
          agent={agent}
          logs={logs}
          username={username}
          isMobile={isMobile}
          connected={connected}
          messagesRef={messagesRef}
          onScroll={handleScroll}
          onEditAgent={onEditAgent}
          showAvatar={showAvatar}
          editingLogEntryId={editingLogEntryId}
          setEditingLogEntryId={setEditingLogEntryId}
          getUserMsgRefCb={getUserMsgRefCb}
          onOpenInEditor={features.editor ? openInEditor : undefined}
          onCopyToTerminal={features.terminal ? copyToTerminal : undefined}
          stateChangedAt={stateChangedAt.get(agent.id)}
        />

        {/* Scroll to bottom */}
        {!autoScroll && (
          <button
            onClick={() => {
              if (scrollRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
              }
              setAutoScroll(true);
            }}
            style={{
              position: "absolute",
              bottom: 80,
              right: 32,
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "1px solid var(--border-medium)",
              background: "var(--bg-surface)",
              color: "var(--text-muted)",
              fontSize: 16,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
              zIndex: 5,
              transition: "opacity 0.15s",
            }}
            title="Scroll to bottom"
          >
            ↓
          </button>
        )}

        <QueueChips queue={agent.queue ?? []} agentId={agent.id} isMobile={isMobile} />
        <InputBar
          agent={agent}
          input={input}
          setInput={setInput}
          inputRef={inputRef}
          textareaRef={textareaRef}
          autoResize={autoResize}
          isBusy={isBusy}
          editingLogEntryId={editingLogEntryId}
          username={username}
          onSent={() => setAutoScroll(true)}
          stagedAttachments={attachments.stagedAttachments}
          validAttachments={attachments.validAttachments}
          hasUploading={attachments.hasUploading}
          handleFileSelect={attachments.handleFileSelect}
          removeStaged={attachments.removeStaged}
          clearAttachments={attachments.clear}
          handlePaste={attachments.handlePaste}
          draggingOver={attachments.draggingOver}
          isListening={voice.isListening}
          startListening={voice.startListening}
          stopListening={voice.stopListening}
          showMicHint={voice.showMicHint}
          setShowMicHint={voice.setShowMicHint}
          speechApiPresent={voice.speechApiPresent}
          isSecureContext={voice.isSecureContext}
          showAutocomplete={autocomplete.showAutocomplete}
          filteredCommands={autocomplete.filteredCommands}
          skillOrigins={autocomplete.skillOrigins}
          commandDescriptions={autocomplete.commandDescriptions}
          selectedIdx={autocomplete.selectedIdx}
          setSelectedIdx={autocomplete.setSelectedIdx}
          partial={autocomplete.partial}
        />
      </div>
      {features.terminal && !isMobile && terminalOpen && (
        <div ref={terminalContainerRef} style={{ width: terminalWidth, flexShrink: 0, position: "relative" }}>
          <PanelResizer panelRef={terminalContainerRef} min={PANEL_MIN.terminal} getMax={getTerminalMax} onCommit={commitTerminalWidth} />
          <TerminalPanel agentId={agent.id} onClose={() => setTerminalOpen(false)} />
        </div>
      )}
      {features.editor && !isMobile && editorOpen && (
        <div ref={editorContainerRef} style={{ width: editorWidth, flexShrink: 0, position: "relative" }}>
          <PanelResizer panelRef={editorContainerRef} min={PANEL_MIN.editor} getMax={getEditorMax} onCommit={commitEditorWidth} />
          <EditorPanel agentId={agent.id} initialPath={editorInitialPath} onClose={() => setEditorOpen(false)} onPathOpened={() => setEditorInitialPath(null)} />
        </div>
      )}
      {isMobile && features.terminal && terminalOpen && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "100%",
            paddingTop: "env(safe-area-inset-top, 0px)",
            boxSizing: "border-box",
            background: "var(--bg-base)",
            zIndex: 30,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <TerminalPanel agentId={agent.id} onClose={() => setTerminalOpen(false)} mobile />
        </div>
      )}
      {isMobile && features.editor && editorOpen && (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "100%",
            paddingTop: "env(safe-area-inset-top, 0px)",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
            boxSizing: "border-box",
            background: "var(--bg-base)",
            zIndex: 30,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <EditorPanel agentId={agent.id} initialPath={editorInitialPath} onClose={() => setEditorOpen(false)} onPathOpened={() => setEditorInitialPath(null)} mobile />
        </div>
      )}
      {cite && scrollRef.current && <CiteSelectionButton cite={cite} containerRect={scrollRef.current.getBoundingClientRect()} onClick={() => handleCite(cite.text)} />}
    </div>
  );
}
