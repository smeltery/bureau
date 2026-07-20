import type { AgentInfo } from "../../shared/types.ts";
import { CopyButton } from "../components/controls/CopyButton.tsx";
import { PersonIcon } from "../components/controls/Icons.tsx";
import { StatusLight } from "../office/scene/StatusLight.tsx";
import { HeaderTimer, STATE_LABELS } from "./StateIndicators.tsx";
import { ContextMeter } from "./components/ContextMeter.tsx";

export function HeaderMobile({
  agent,
  logs,
  onBack,
  onEditAgent,
  onOpenTasks,
  showAvatar,
  toggleAvatar,
  stateChangedAt,
  getConversationText,
}: {
  agent: AgentInfo;
  logs: unknown[];
  onBack: () => void;
  onEditAgent: () => void;
  onOpenTasks?: () => void;
  showAvatar: boolean;
  toggleAvatar: () => void;
  stateChangedAt?: number;
  getConversationText: () => string;
}) {
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
          {STATE_LABELS[agent.state] && <HeaderTimer state={agent.state} stateChangedAt={stateChangedAt} />}
          <ContextMeter usage={agent.contextUsage} />
          {onOpenTasks && (
            <button
              onClick={onOpenTasks}
              style={{
                padding: "2px 7px",
                borderRadius: 6,
                border: "1px solid var(--border-medium)",
                background: "var(--btn-surface)",
                color: "var(--text-dim)",
                fontSize: 11,
                cursor: "pointer",
                flexShrink: 0,
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
