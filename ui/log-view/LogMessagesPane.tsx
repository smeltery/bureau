import { useMemo, type RefCallback } from "react";
import type { AgentInfo, LogEntry } from "../../shared/types.ts";
import { send } from "../ws.ts";
import { Character } from "../office/scene/Character.tsx";
import { ActivityIndicator, SessionSwapIndicator } from "./StateIndicators.tsx";
import { isFoldedToolResult, LogEntryCard } from "./entries/index.tsx";

const MODEL_TINT: Record<string, { border: string; bg: string }> = {
  opus: { border: "rgba(100,160,255,0.85)", bg: "rgba(100,160,255,0.35)" },
  sonnet: { border: "rgba(218,165,32,0.80)", bg: "rgba(218,165,32,0.32)" },
  haiku: { border: "rgba(230,130,180,0.80)", bg: "rgba(230,130,180,0.32)" },
};

export function LogMessagesPane({
  agent,
  logs,
  username,
  isMobile,
  connected,
  messagesRef,
  onScroll,
  onEditAgent,
  showAvatar,
  editingLogEntryId,
  setEditingLogEntryId,
  getUserMsgRefCb,
  onOpenInEditor,
  onCopyToTerminal,
  stateChangedAt,
}: {
  agent: AgentInfo;
  logs: LogEntry[];
  username: string;
  isMobile: boolean;
  connected: boolean;
  messagesRef: RefCallback<HTMLDivElement>;
  onScroll: () => void;
  onEditAgent: () => void;
  showAvatar: boolean;
  editingLogEntryId: string | null;
  setEditingLogEntryId: (id: string | null) => void;
  getUserMsgRefCb: (id: string) => RefCallback<HTMLDivElement>;
  onOpenInEditor?: (path: string) => void;
  onCopyToTerminal?: (command: string) => void;
  stateChangedAt?: number;
}) {
  const turnData = useLogTurnData(logs);

  return (
    <div
      ref={messagesRef}
      onScroll={onScroll}
      style={{
        flex: 1,
        overflowY: "auto",
        overflowX: "hidden",
        padding: isMobile ? "12px 12px" : "16px 24px",
        color: "var(--text-secondary)",
        position: "relative",
      }}
    >
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
            onOpenInEditor={onOpenInEditor}
            onCopyToTerminal={onCopyToTerminal}
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
      <ActivityIndicator state={agent.state} stateChangedAt={stateChangedAt} agentId={agent.id} />
      <SessionSwapIndicator swapping={agent.sessionSwapping ?? false} />
    </div>
  );
}

function useLogTurnData(logs: LogEntry[]) {
  return useMemo(() => {
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
      let lastVisibleIdx = -1;
      for (let i = turn.entries.length - 1; i >= 0; i--) {
        if (!isFoldedToolResult(turn.entries[i], turn.entries)) {
          lastVisibleIdx = i;
          break;
        }
      }
      for (let i = 0; i < turn.entries.length; i++) {
        entryMap.set(turn.entries[i].id, { isLastInTurn: i === lastVisibleIdx, turnEntries: turn.entries });
      }
    }
    return entryMap;
  }, [logs]);
}
