import { useState } from "react";
import type { AgentInfo } from "../../shared/types.ts";
import { familyDisplayLabel } from "../../shared/types.ts";
import { useAppState, useFeatures, useTheme } from "../store.tsx";
import { CopyButton } from "../components/controls/CopyButton.tsx";
import { MoonIcon, PersonIcon, SunIcon } from "../components/controls/Icons.tsx";
import { ThemePicker } from "../components/ThemePicker.tsx";
import { StatusLight } from "../office/scene/StatusLight.tsx";
import { HeaderTimer, STATE_LABELS } from "./StateIndicators.tsx";
import { HeaderTopic } from "./HeaderTopic.tsx";
import { HeaderMobile } from "./HeaderMobile.tsx";

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

  const [themePickerOpen, setThemePickerOpen] = useState(false);

  if (isMobile) {
    return (
      <HeaderMobile
        agent={agent}
        logs={logs}
        onBack={onBack}
        onEditAgent={onEditAgent}
        showAvatar={showAvatar}
        toggleAvatar={toggleAvatar}
        stateChangedAt={stateChangedAt.get(agent.id)}
        getConversationText={getConversationText}
      />
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
        <HeaderTopic agent={agent} />
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
