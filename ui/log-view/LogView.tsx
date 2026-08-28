import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefCallback } from "react";
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
import { useLogViewInput } from "./hooks/useLogViewInput.ts";
import { useLogViewCite } from "./hooks/useLogViewCite.ts";
import { storageGetItem, storageSetItem } from "../browser-storage.ts";
import { CiteSelectionButton } from "./CiteSelectionButton.tsx";
import { LogMessagesPane } from "./LogMessagesPane.tsx";
import { LogViewPanelHost } from "./side-panels/LogViewPanelHost.tsx";
import { PinnedUserMessageBanner } from "./PinnedUserMessageBanner.tsx";
import { ScrollToBottomButton } from "./ScrollToBottomButton.tsx";
import { DeckView } from "./deck/DeckView.tsx";
import { useSlideMode } from "../hooks/useSlideMode.ts";
import { useSpeechLocale } from "../hooks/useSpeechLocale.ts";

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
  const slideMode = useSlideMode(agent.id);
  const speechLocale = useSpeechLocale();

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
  const [showAvatar, setShowAvatar] = useState(() => storageGetItem("bureau-show-avatar") !== "false");
  const toggleAvatar = useCallback(
    () =>
      setShowAvatar((prev) => {
        const next = !prev;
        storageSetItem("bureau-show-avatar", String(next));
        return next;
      }),
    [],
  );
  const [editingLogEntryId, setEditingLogEntryId] = useState<string | null>(null);

  // Hooks owning their own concerns
  const vpHeight = useViewportHeight(isMobile, scrollRef);
  const { autoScroll, setAutoScroll, handleScroll: handleAutoScroll } = useAutoScroll(scrollRef, logs, agent.state);
  const { pinnedMessage, scrollToPinnedMessage, getUserMsgRefCb, recomputePinned } = usePinnedUserMessage(scrollRef, logs, agent.state);
  const savedChatScrollRef = useRef<{ agentId: string; top: number } | null>(null);
  const handleChatScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) savedChatScrollRef.current = { agentId: agent.id, top: el.scrollTop };
    handleAutoScroll();
  }, [agent.id, handleAutoScroll]);

  useLayoutEffect(() => {
    if (slideMode.active || autoScroll) return;
    const el = scrollRef.current;
    const saved = savedChatScrollRef.current;
    if (!el || !saved || saved.agentId !== agent.id) return;
    el.scrollTop = saved.top;
  }, [agent.id, autoScroll, slideMode.active]);

  const { cite, handleCite, handleScroll } = useLogViewCite({
    inputRef,
    textareaRef,
    setInput,
    autoResize,
    editingLogEntryId,
    scrollRef,
    handleAutoScroll: handleChatScroll,
    recomputePinned,
  });
  const handleTerminalSendToChat = useCallback((text: string) => handleCite(text, "Terminal output"), [handleCite]);
  const autocomplete = useSlashAutocomplete(input, slashCommands.get(agent.id));
  const voice = useVoiceInput({
    inputRef,
    locale: speechLocale,
    onTranscript: (text) => dispatch({ type: "set_draft", agentId: agent.id, text }),
    onGrow: () => {
      if (textareaRef.current) autoResize(textareaRef.current);
    },
  });
  const setInputFromUser = useCallback(
    (text: string) => {
      voice.reconcileDraftEdit(text);
      setInput(text);
    },
    [setInput, voice],
  );
  const attachments = useAttachmentUpload(agent.id);

  const isBusy = agent.state === "thinking" || agent.state === "tool_executing";
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

  const inputBar = (
    <InputBar
      agent={agent}
      input={input}
      setInput={setInputFromUser}
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
      stopListening={voice.stopListening}
      toggleListening={voice.toggleListening}
      showMicHint={voice.showMicHint}
      setShowMicHint={voice.setShowMicHint}
      speechApiPresent={voice.speechApiPresent}
      isSecureContext={voice.isSecureContext}
      voiceInputError={voice.voiceInputError}
      showAutocomplete={autocomplete.showAutocomplete}
      filteredCommands={autocomplete.filteredCommands}
      skillOrigins={autocomplete.skillOrigins}
      commandDescriptions={autocomplete.commandDescriptions}
      selectedIdx={autocomplete.selectedIdx}
      setSelectedIdx={autocomplete.setSelectedIdx}
      partial={autocomplete.partial}
      availableCommands={slashCommands.get(agent.id)?.commands ?? []}
      availableSkills={slashCommands.get(agent.id)?.skills ?? []}
    />
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
          terminalOpen={panels.terminalOpen}
          setTerminalOpen={panels.setTerminalOpen}
          editorOpen={panels.editorOpen}
          setEditorOpen={panels.setEditorOpen}
          slideModeEnabled={slideMode.enabled}
          slideView={slideMode.active}
          setSlideView={slideMode.setActive}
          getConversationText={getConversationText}
        />

        {pinnedMessage && <PinnedUserMessageBanner pinnedMessage={pinnedMessage} isMobile={isMobile} onClick={scrollToPinnedMessage} />}

        {slideMode.active ? (
          <DeckView agent={agent} logs={logs} isMobile={isMobile} inputBar={inputBar} />
        ) : (
          <>
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
            {inputBar}
          </>
        )}
      </div>
      <LogViewPanelHost agentId={agent.id} isMobile={isMobile} terminalEnabled={features.terminal} editorEnabled={features.editor} panels={panels} onSendTerminalToChat={handleTerminalSendToChat} />
      {cite && scrollRef.current && <CiteSelectionButton cite={cite} containerRect={scrollRef.current.getBoundingClientRect()} onClick={() => handleCite(cite.text)} />}
    </div>
  );
}
