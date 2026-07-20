import type { AgentInfo } from "../../shared/types.ts";
import { familyDisplayLabel } from "../../shared/types.ts";
import { useAppState } from "../store.tsx";
import { StatusLight } from "../office/scene/StatusLight.tsx";
import { HeaderTimer, STATE_LABELS } from "./StateIndicators.tsx";
import { HeaderTopic } from "./HeaderTopic.tsx";
import { HeaderMobile } from "./HeaderMobile.tsx";
import { HeaderActions } from "./header/HeaderActions.tsx";
import { ContextMeter } from "./components/ContextMeter.tsx";

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

  if (isMobile) {
    return (
      <HeaderMobile
        agent={agent}
        logs={logs}
        onBack={onBack}
        onEditAgent={onEditAgent}
        onOpenTasks={onOpenTasks}
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
        <ContextMeter usage={agent.contextUsage} />
      </div>
      <HeaderActions
        logs={logs}
        onOpenTasks={onOpenTasks}
        showAvatar={showAvatar}
        toggleAvatar={toggleAvatar}
        terminalOpen={terminalOpen}
        setTerminalOpen={setTerminalOpen}
        editorOpen={editorOpen}
        setEditorOpen={setEditorOpen}
        getConversationText={getConversationText}
      />
    </div>
  );
}
