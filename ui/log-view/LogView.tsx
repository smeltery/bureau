import { useCallback, useEffect, useMemo, useRef, useState, type RefCallback } from "react";
import type { AgentInfo, LogEntry } from "../../shared/types.ts";
import { type ModelFamily } from "../../shared/types.ts";
import { send } from "../ws.ts";
import { useAppState, useDispatch, useFeatures } from "../store.tsx";
import { Character } from "../office/scene/Character.tsx";
import { useSwipeLeftRight } from "../hooks/useSwipeLeftRight.ts";
import { LogEntryCard, serializeEntries } from "./entries/index.tsx";
import { TerminalPanel } from "./TerminalPanel.tsx";
import { Header } from "./Header.tsx";
import { InputBar } from "./InputBar.tsx";
import { ActivityIndicator } from "./StateIndicators.tsx";
import { useViewportHeight } from "./hooks/useViewportHeight.ts";
import { useAutoScroll } from "./hooks/useAutoScroll.ts";
import { usePinnedUserMessage } from "./hooks/usePinnedUserMessage.ts";
import { useSlashAutocomplete } from "./hooks/useSlashAutocomplete.ts";
import { useVoiceInput } from "./hooks/useVoiceInput.ts";
import { useAttachmentUpload } from "./hooks/useAttachmentUpload.ts";

const MODEL_TINT: Record<ModelFamily, { border: string; bg: string }> = {
  opus: { border: "rgba(100,160,255,0.85)", bg: "rgba(100,160,255,0.35)" },
  sonnet: { border: "rgba(218,165,32,0.80)", bg: "rgba(218,165,32,0.32)" },
  haiku: { border: "rgba(230,130,180,0.80)", bg: "rgba(230,130,180,0.32)" },
};

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
  const { drafts, slashCommands, stateChangedAt, isMobile } = useAppState();
  const dispatch = useDispatch();
  const features = useFeatures();

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
  const messagesRef: RefCallback<HTMLDivElement> = useCallback((node) => {
    (scrollRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
    (swipeRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
  }, []);

  // Chrome + UI state
  const [terminalOpen, setTerminalOpen] = useState(false);
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
  const handleScroll = useCallback(() => {
    handleAutoScroll();
    recomputePinned();
  }, [handleAutoScroll, recomputePinned]);
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

  // Compute agent turns: group entries between user_messages.
  // For each entry, determine if it's the last in its agent turn (used by
  // LogEntryCard to decide where to render turn-level copy buttons).
  const turnData = useMemo(() => {
    let currentTurn: { entries: LogEntry[] } = { entries: [] };
    const turns: { entries: LogEntry[] }[] = [];
    for (let i = 0; i < logs.length; i++) {
      const entry = logs[i];
      if (entry.kind === "user_message") {
        if (currentTurn.entries.length > 0) turns.push(currentTurn);
        turns.push({ entries: [entry] });
        currentTurn = { entries: [] };
      } else {
        currentTurn.entries.push(entry);
      }
    }
    if (currentTurn.entries.length > 0) turns.push(currentTurn);

    const entryMap = new Map<string, { isLastInTurn: boolean; turnEntries: LogEntry[] }>();
    for (const turn of turns) {
      if (turn.entries.length === 1 && turn.entries[0].kind === "user_message") {
        entryMap.set(turn.entries[0].id, { isLastInTurn: false, turnEntries: [] });
        continue;
      }
      for (let i = 0; i < turn.entries.length; i++) {
        const isLast = i === turn.entries.length - 1;
        entryMap.set(turn.entries[i].id, { isLastInTurn: isLast, turnEntries: turn.entries });
      }
    }
    return entryMap;
  }, [logs]);

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
          terminalOpen={terminalOpen}
          setTerminalOpen={setTerminalOpen}
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

        {/* Messages */}
        <div
          ref={messagesRef}
          onScroll={handleScroll}
          style={{
            flex: 1,
            overflowY: "auto",
            overflowX: "hidden",
            padding: isMobile ? "12px 12px" : "16px 24px",
            color: "var(--text-secondary)",
            position: "relative",
          }}
        >
          {/* Floating agent portrait */}
          <div
            onClick={onEditAgent}
            style={{
              position: "sticky",
              top: isMobile ? 12 : 16,
              float: "right",
              marginRight: 0,
              zIndex: 10,
              width: 62,
              height: 78,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 8,
              border: `2px solid ${MODEL_TINT[agent.modelFamily]?.border ?? "var(--border-medium)"}`,
              background: MODEL_TINT[agent.modelFamily]?.bg ?? "rgba(128,128,128,0.2)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              cursor: "pointer",
              opacity: showAvatar ? 1 : 0,
              pointerEvents: showAvatar ? "auto" : "none",
              transition: "opacity 0.2s",
            }}
            title="Edit agent"
          >
            <Character key={agent.state} state={agent.state} outfit={agent.outfit} />
          </div>
          {logs.length === 0 && <div style={{ color: "var(--text-ghost)", textAlign: "center", marginTop: 40 }}>Send a message to start a conversation.</div>}
          {logs.map((entry) => {
            const td = turnData.get(entry.id);
            const canEditMsg = entry.kind === "user_message" && agent.state === "waiting_for_response" && !editingLogEntryId;
            const isUserMsg = entry.kind === "user_message";
            const card = (
              <LogEntryCard
                entry={entry}
                isLastInTurn={td?.isLastInTurn}
                turnEntries={td?.turnEntries}
                isMobile={isMobile}
                canEdit={canEditMsg}
                isEditing={editingLogEntryId === entry.id}
                onStartEdit={(id) => setEditingLogEntryId(id)}
                onCancelEdit={() => setEditingLogEntryId(null)}
                onSubmitEdit={(id, newText) => {
                  setEditingLogEntryId(null);
                  send({ type: "edit_message", agentId: agent.id, logEntryId: id, newText, username });
                }}
              />
            );
          })}
          <ActivityIndicator state={agent.state} stateChangedAt={stateChangedAt.get(agent.id)} agentId={agent.id} />
        </div>

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
        <div style={{ width: "40%", minWidth: 300, maxWidth: 600, flexShrink: 0 }}>
          <TerminalPanel agentId={agent.id} onClose={() => setTerminalOpen(false)} />
        </div>
      )}
    </div>
  );
}
