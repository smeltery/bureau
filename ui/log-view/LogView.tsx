import { useCallback, useEffect, useMemo, useRef, useState, type RefCallback } from "react";
import type { AgentInfo, LogEntry } from "../../shared/types.ts";
import { type ModelFamily } from "../../shared/types.ts";
import { send } from "../ws.ts";
import { useAppState, useDispatch, useFeatures } from "../store.tsx";
import { Character } from "../office/scene/Character.tsx";
import { useSwipeLeftRight } from "../hooks/useSwipeLeftRight.ts";
import { LogEntryCard, serializeEntries } from "./entries/index.tsx";
import { TerminalPanel } from "./TerminalPanel.tsx";
import { EditorPanel } from "./EditorPanel.tsx";
import { PanelResizer } from "./PanelResizer.tsx";
import { Header } from "./Header.tsx";
import { InputBar } from "./InputBar.tsx";
import { QueueChips } from "./QueueChips.tsx";
import { ActivityIndicator, SessionSwapIndicator } from "./StateIndicators.tsx";
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

// Side panel size constraints. Editor has a higher min than terminal so the
// tab strip + line numbers don't squeeze content into a useless column.
const PANEL_MIN = { terminal: 300, editor: 380 } as const;
const PANEL_MAX = { terminal: 1000, editor: 1200 } as const;
// The chat column always keeps at least this many pixels regardless of how
// far the boss drags the panel.
const CHAT_COLUMN_FLOOR = 300;

function readPanelWidth(kind: "terminal" | "editor", fallback: number): number {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(`bureau:panel-width:${kind}`);
    if (raw === null) return fallback;
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.max(PANEL_MIN[kind], Math.min(PANEL_MAX[kind], n));
  } catch {
    return fallback;
  }
}

function writePanelWidth(kind: "terminal" | "editor", width: number): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(`bureau:panel-width:${kind}`, String(Math.round(width)));
  } catch {}
}

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

  // Side panel widths (persisted to localStorage per kind). Read at mount,
  // clamped on window resize so a shrinking browser can't push the chat
  // column below CHAT_COLUMN_FLOOR.
  const [terminalWidth, setTerminalWidth] = useState<number>(() => readPanelWidth("terminal", 500));
  const [editorWidth, setEditorWidth] = useState<number>(() => readPanelWidth("editor", 600));
  const terminalContainerRef = useRef<HTMLDivElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const commitTerminalWidth = useCallback((w: number) => {
    setTerminalWidth(w);
    writePanelWidth("terminal", w);
  }, []);
  const commitEditorWidth = useCallback((w: number) => {
    setEditorWidth(w);
    writePanelWidth("editor", w);
  }, []);
  const getTerminalMax = useCallback(() => {
    return Math.max(PANEL_MIN.terminal, Math.min(PANEL_MAX.terminal, window.innerWidth - CHAT_COLUMN_FLOOR));
  }, []);
  const getEditorMax = useCallback(() => {
    return Math.max(PANEL_MIN.editor, Math.min(PANEL_MAX.editor, window.innerWidth - CHAT_COLUMN_FLOOR));
  }, []);
  useEffect(() => {
    function clamp() {
      const maxAllowed = Math.max(PANEL_MIN.terminal, window.innerWidth - CHAT_COLUMN_FLOOR);
      setTerminalWidth((w) => (w > maxAllowed ? maxAllowed : w));
      const maxAllowedEditor = Math.max(PANEL_MIN.editor, window.innerWidth - CHAT_COLUMN_FLOOR);
      setEditorWidth((w) => (w > maxAllowedEditor ? maxAllowedEditor : w));
    }
    window.addEventListener("resize", clamp);
    clamp();
    return () => window.removeEventListener("resize", clamp);
  }, []);

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
  const copyToTerminal = useCallback(
    (command: string) => {
      const wasOpen = sidePanels.get(agent.id) === "terminal";
      dispatch({ type: "set_side_panel", agentId: agent.id, panel: "terminal" });
      const delay = wasOpen ? 0 : 250;
      setTimeout(() => {
        send({ type: "terminal_input", agentId: agent.id, data: command });
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
          {logs.length === 0 && <div style={{ color: "var(--text-ghost)", textAlign: "center", marginTop: 40 }}>{connected ? "Send a message to start a conversation." : "Loading..."}</div>}
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
                onOpenInEditor={features.editor ? openInEditor : undefined}
                onCopyToTerminal={features.terminal ? copyToTerminal : undefined}
              />
            );
            return isUserMsg ? (
              <div key={entry.id} ref={getUserMsgRefCb(entry.id)}>
                {card}
              </div>
            ) : (
              <div key={entry.id}>{card}</div>
            );
          })}
          <ActivityIndicator state={agent.state} stateChangedAt={stateChangedAt.get(agent.id)} agentId={agent.id} />
          <SessionSwapIndicator swapping={agent.sessionSwapping ?? false} />
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
    </div>
  );
}
