import { useRef, useState } from "react";
import type { AgentInfo } from "../../shared/types.ts";
import { familyDisplayLabel } from "../../shared/types.ts";
import { send } from "../ws.ts";
import { useAppState, useFeatures, useTheme } from "../store.tsx";
import { CopyButton } from "../components/controls/CopyButton.tsx";
import { MoonIcon, PersonIcon, SunIcon } from "../components/controls/Icons.tsx";
import { ThemePicker } from "../components/ThemePicker.tsx";
import { StatusLight } from "../office/scene/StatusLight.tsx";
import { HeaderTimer, STATE_LABELS } from "./StateIndicators.tsx";

export function Header({
  agent,
  logs,
  onBack,
  onEditAgent,
  onOpenTasks,
  showAvatar,
  toggleAvatar,
  terminalOpen,
  setTerminalOpen,
  editorOpen,
  setEditorOpen,
  getConversationText,
}: {
  agent: AgentInfo;
  logs: unknown[];
  onBack: () => void;
  onEditAgent: () => void;
  onOpenTasks?: () => void;
  showAvatar: boolean;
  toggleAvatar: () => void;
  terminalOpen: boolean;
  setTerminalOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  editorOpen: boolean;
  setEditorOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  getConversationText: () => string;
}) {
  const { stateChangedAt, isMobile } = useAppState();
  const { mode } = useTheme();
  const features = useFeatures();

  const [editingTopic, setEditingTopic] = useState(false);
  const [topicDraft, setTopicDraft] = useState("");
  const topicInputRef = useRef<HTMLInputElement>(null);
  const topicSavedRef = useRef(false);
  const [themePickerOpen, setThemePickerOpen] = useState(false);

  if (isMobile) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "row",
          alignItems: "stretch",
          padding: "0 12px 0 0",
          paddingTop: "env(safe-area-inset-top, 0px)",
          background: "var(--bg-surface)",
          borderBottom: "1px solid var(--border-strong)",
          flexShrink: 0,
        }}
      >
        <button
          onClick={onBack}
          style={{
            padding: "12px 14px",
            border: "none",
            borderRight: "1px solid var(--border-medium)",
            background: "var(--btn-surface)",
            color: "var(--text-dim)",
            fontSize: 20,
            cursor: "pointer",
            lineHeight: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          ←
        </button>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", padding: "8px 10px", gap: 2 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <StatusLight state={agent.state} size={8} />
            <span
              onClick={onEditAgent}
              style={{
                fontWeight: 600,
                color: "var(--text-primary)",
                fontSize: 15,
                cursor: "pointer",
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {agent.name}
              {agent.room > 0 ? (
                <span style={{ opacity: 0.4, fontWeight: 400, fontSize: 12, marginLeft: 6 }}>
                  R{agent.room + 1}:{agent.desk + 1}
                </span>
              ) : (
                ""
              )}
            </span>
            {STATE_LABELS[agent.state] && <HeaderTimer state={agent.state} stateChangedAt={stateChangedAt.get(agent.id)} />}
            {logs.length > 0 && <CopyButton getText={getConversationText} />}
            <button
              onClick={toggleAvatar}
              title={showAvatar ? "Hide agent avatar" : "Show agent avatar"}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "2px 6px",
                borderRadius: 6,
                border: "1px solid var(--border-medium)",
                background: "var(--btn-surface)",
                color: "var(--text-dim)",
                cursor: "pointer",
                opacity: showAvatar ? 1 : 0.35,
                transition: "opacity 0.2s",
                flexShrink: 0,
              }}
            >
              <PersonIcon />
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 16 }}>
            <span
              style={{
                fontFamily: "'JetBrains Mono',monospace",
                color: "var(--text-muted)",
                fontSize: 12,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
              }}
            >
              {agent.cwd}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 16px",
        height: 48,
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border-strong)",
        flexShrink: 0,
      }}
    >
      <button
        onClick={onBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 14px",
          borderRadius: 8,
          border: "1px solid var(--border-medium)",
          background: "var(--btn-surface)",
          color: "var(--text-dim)",
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        ← Back to Office
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, flex: 1, minWidth: 0, marginLeft: 12 }}>
        <span style={{ flexShrink: 0 }}>
          <StatusLight state={agent.state} size={8} />
        </span>
        <span onClick={onEditAgent} style={{ fontWeight: 600, color: "var(--text-primary)", cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0 }} title="Edit agent">
          <span style={{ opacity: 0.5 }}>
            {agent.room > 0 ? `R${agent.room + 1}:` : ""}
            {agent.desk + 1} ·
          </span>{" "}
          {agent.name}
        </span>
        {STATE_LABELS[agent.state] && <HeaderTimer state={agent.state} stateChangedAt={stateChangedAt.get(agent.id)} />}
        {agent.topic && agent.topic !== "..." && !editingTopic && (
          <>
            <span style={{ color: "var(--text-ghost)" }}>&middot;</span>
            <span
              onClick={() => {
                setEditingTopic(true);
                setTopicDraft(agent.topic ?? "");
                setTimeout(() => topicInputRef.current?.focus(), 0);
              }}
              style={{
                color: "var(--text-secondary)",
                fontSize: 13,
                cursor: "text",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                minWidth: 0,
              }}
              title={agent.topic ?? "Click to edit topic"}
            >
              {agent.topic}
            </span>
            <button
              onClick={() => send({ type: "reset_topic", agentId: agent.id })}
              disabled={!agent.topicStale}
              title={agent.topicStale ? "Regenerate topic from conversation" : "No new messages since last generation"}
              style={{
                background: "none",
                border: "none",
                cursor: agent.topicStale ? "pointer" : "default",
                color: "var(--text-secondary)",
                fontSize: 15,
                padding: "0 4px",
                opacity: agent.topicStale ? 0.8 : 0.3,
                transition: "opacity 0.2s",
                lineHeight: 1,
              }}
            >
              ↻
            </button>
          </>
        )}
        {agent.topic === "..." && (
          <>
            <span style={{ color: "var(--text-ghost)" }}>&middot;</span>
            <span style={{ color: "var(--text-ghost)", fontSize: 13 }}>...</span>
          </>
        )}
        {editingTopic && (
          <input
            ref={topicInputRef}
            value={topicDraft}
            onChange={(e) => setTopicDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                const trimmed = topicDraft.trim();
                if (trimmed && trimmed !== agent.topic) {
                  send({ type: "set_topic", agentId: agent.id, topic: trimmed });
                }
                topicSavedRef.current = true;
                setEditingTopic(false);
              }
              if (e.key === "Escape") {
                topicSavedRef.current = true;
                setEditingTopic(false);
              }
            }}
            onBlur={() => {
              if (topicSavedRef.current) {
                topicSavedRef.current = false;
                setEditingTopic(false);
                return;
              }
              const trimmed = topicDraft.trim();
              if (trimmed && trimmed !== agent.topic) {
                send({ type: "set_topic", agentId: agent.id, topic: trimmed });
              }
              setEditingTopic(false);
            }}
            style={{
              background: "transparent",
              border: "1px solid var(--border-medium)",
              borderRadius: 4,
              color: "var(--text-muted)",
              fontSize: 12,
              padding: "1px 6px",
              outline: "none",
              width: 200,
            }}
          />
        )}
        <span style={{ color: "var(--text-ghost)", flexShrink: 0 }}>&middot;</span>
        <span
          title={agent.cwd}
          style={{
            fontFamily: "'JetBrains Mono',monospace",
            color: "var(--text-muted)",
            fontSize: 12,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
            flexShrink: 1,
          }}
        >
          {agent.cwd.replace(/^\/home\/[^/]+/, "~")}
        </span>
        <span style={{ color: "var(--text-ghost)", flexShrink: 0 }}>&middot;</span>
        <span
          style={{
            fontFamily: "'JetBrains Mono',monospace",
            color: "var(--text-ghost)",
            fontSize: 11,
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {familyDisplayLabel(agent.modelFamily)}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end", flexShrink: 0, marginLeft: 12 }}>
        {onOpenTasks && (
          <button
            onClick={onOpenTasks}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: "1px solid var(--border-medium)",
              background: "var(--btn-surface)",
              color: "var(--text-dim)",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Tasks
          </button>
        )}
        {logs.length > 0 && <CopyButton getText={getConversationText} />}
        <button
          onClick={toggleAvatar}
          title={showAvatar ? "Hide agent avatar" : "Show agent avatar"}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "4px 8px",
            borderRadius: 6,
            border: "1px solid var(--border-medium)",
            background: "var(--btn-surface)",
            color: "var(--text-dim)",
            cursor: "pointer",
            opacity: showAvatar ? 1 : 0.35,
            transition: "opacity 0.2s",
          }}
        >
          <PersonIcon />
        </button>
        <button
          onClick={() => setThemePickerOpen(true)}
          title="Change theme"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "4px 8px",
            borderRadius: 6,
            border: "1px solid var(--border-medium)",
            background: "var(--btn-surface)",
            color: "var(--text-dim)",
            cursor: "pointer",
          }}
        >
          {mode === "dark" ? <MoonIcon /> : <SunIcon />}
        </button>
        <ThemePicker open={themePickerOpen} onClose={() => setThemePickerOpen(false)} />
        {features.editor && (
          <button
            onClick={() => setEditorOpen((prev) => !prev)}
            title={editorOpen ? "Close editor" : "Open editor"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "4px 10px",
              borderRadius: 6,
              border: `1px solid ${editorOpen ? "var(--green-border)" : "var(--border-medium)"}`,
              background: editorOpen ? "var(--green-bg)" : "var(--btn-surface)",
              color: editorOpen ? "var(--green)" : "var(--text-dim)",
              fontSize: 12,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{}</span>
          </button>
        )}
        {features.terminal && (
          <button
            onClick={() => setTerminalOpen((prev) => !prev)}
            title={terminalOpen ? "Close terminal (Ctrl+`)" : "Open terminal (Ctrl+`)"}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "4px 10px",
              borderRadius: 6,
              border: `1px solid ${terminalOpen ? "var(--green-border)" : "var(--border-medium)"}`,
              background: terminalOpen ? "var(--green-bg)" : "var(--btn-surface)",
              color: terminalOpen ? "var(--green)" : "var(--text-dim)",
              fontSize: 12,
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>&gt;_</span>
          </button>
        )}
      </div>
    </div>
  );
}
