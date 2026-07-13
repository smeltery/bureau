import { useCallback, useEffect, useMemo, useRef, useState, type RefCallback } from "react";
import type { AgentInfo, LogEntry } from "../../shared/types.ts";
import { useAppState, useDispatch, useFeatures } from "../store.tsx";
import { useSwipeLeftRight } from "../hooks/useSwipeLeftRight.ts";
import { serializeEntries } from "./entries/index.tsx";
import { Header } from "./Header.tsx";
import { InputBar } from "./InputBar.tsx";
import { QueueChips } from "./QueueChips.tsx";
import { useViewportHeight } from "./hooks/useViewportHeight.ts";
import { useAutoScroll } from "./hooks/useAutoScroll.ts";
import { usePinnedUserMessage } from "./hooks/usePinnedUserMessage.ts";
import { useSlashAutocomplete } from "./hooks/useSlashAutocomplete.ts";
import { useVoiceInput } from "./hooks/useVoiceInput.ts";
import { useAttachmentUpload } from "./hooks/useAttachmentUpload.ts";
import { useLogViewPanels } from "./hooks/useLogViewPanels.ts";
import { useCiteInsertion } from "./hooks/useCiteInsertion.ts";
import { useLogViewInput } from "./hooks/useLogViewInput.ts";
import { useSelectionCite } from "./useSelectionCite.ts";
import { CiteSelectionButton } from "./CiteSelectionButton.tsx";
import { LogMessagesPane } from "./LogMessagesPane.tsx";
import { DesktopEditorSidePanel, DesktopTerminalSidePanel, MobileEditorSidePanel, MobileTerminalSidePanel } from "./LogViewSidePanels.tsx";
import { PinnedUserMessageBanner } from "./PinnedUserMessageBanner.tsx";
import { ScrollToBottomButton } from "./ScrollToBottomButton.tsx";

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
  const { drafts, slashCommands, stateChangedAt, isMobile, connected } = useAppState();
  const dispatch = useDispatch();
  const features = useFeatures();
  const panels = useLogViewPanels(agent.id);

  // Input draft + textarea ref
  const input = drafts.get(agent.id) ?? "";
  const { inputRef, setInput, textareaRef, autoResize } = useLogViewInput(agent.id, input, dispatch);

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
  const handleCite = useCiteInsertion({
    inputRef,
    textareaRef,
    setInput,
    clearCite,
    autoResize,
  });

  // Dismiss edit textarea when agent is no longer idle (e.g. another tab sent a message)
  useEffect(() => {
    if (agent.state !== "waiting_for_response" && editingLogEntryId) {
      setEditingLogEntryId(null);
    }
  }, [agent.state]);

  // Ctrl+` to toggle terminal panel
  useEffect(() => {
    function handleTerminalShortcut(e: KeyboardEvent) {
      if (isMobile || !features.terminal) return;
      if (e.key === "`" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        panels.setTerminalOpen((prev) => !prev);
      }
    }
    window.addEventListener("keydown", handleTerminalShortcut);
    return () => window.removeEventListener("keydown", handleTerminalShortcut);
  }, [isMobile, features.terminal, panels.setTerminalOpen]);

  const getConversationText = useCallback(() => serializeEntries(logs), [logs]);

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
          terminalOpen={panels.terminalOpen}
          setTerminalOpen={panels.setTerminalOpen}
          editorOpen={panels.editorOpen}
          setEditorOpen={panels.setEditorOpen}
          getConversationText={getConversationText}
        />

        {pinnedMessage && <PinnedUserMessageBanner pinnedMessage={pinnedMessage} isMobile={isMobile} onClick={scrollToPinnedMessage} />}

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
          onOpenInEditor={features.editor ? panels.openInEditor : undefined}
          onCopyToTerminal={features.terminal ? panels.copyToTerminal : undefined}
          stateChangedAt={stateChangedAt.get(agent.id)}
        />

        {!autoScroll && (
          <ScrollToBottomButton
            onClick={() => {
              if (scrollRef.current) {
                scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
              }
              setAutoScroll(true);
            }}
          />
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
      {features.terminal && !isMobile && panels.terminalOpen && (
        <DesktopTerminalSidePanel
          agentId={agent.id}
          panelRef={panels.terminalContainerRef}
          width={panels.terminalWidth}
          getMax={panels.getTerminalMax}
          onCommit={panels.commitTerminalWidth}
          onClose={() => panels.setTerminalOpen(false)}
        />
      )}
      {features.editor && !isMobile && panels.editorOpen && (
        <DesktopEditorSidePanel
          agentId={agent.id}
          panelRef={panels.editorContainerRef}
          width={panels.editorWidth}
          getMax={panels.getEditorMax}
          onCommit={panels.commitEditorWidth}
          initialPath={panels.editorInitialPath}
          onClose={() => panels.setEditorOpen(false)}
          onPathOpened={panels.clearEditorInitialPath}
        />
      )}
      {isMobile && features.terminal && panels.terminalOpen && <MobileTerminalSidePanel agentId={agent.id} onClose={() => panels.setTerminalOpen(false)} />}
      {isMobile && features.editor && panels.editorOpen && (
        <MobileEditorSidePanel agentId={agent.id} initialPath={panels.editorInitialPath} onClose={() => panels.setEditorOpen(false)} onPathOpened={panels.clearEditorInitialPath} />
      )}
      {cite && scrollRef.current && <CiteSelectionButton cite={cite} containerRect={scrollRef.current.getBoundingClientRect()} onClick={() => handleCite(cite.text)} />}
    </div>
  );
}
