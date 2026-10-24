import { useRef, useState } from "react";
import type { AgentInfo } from "../../shared/types.ts";
import { normalizeTopic } from "../../shared/topics/label.ts";
import { useI18n } from "../i18n.tsx";
import { send } from "../ws.ts";

export function HeaderTopic({ agent }: { agent: AgentInfo }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const saved = useRef(false);
  const topic = normalizeTopic(agent.topic);
  const generating = agent.topicGenerating === true;
  const save = () => {
    if (saved.current) return;
    saved.current = true;
    const next = normalizeTopic(draft);
    if (next !== topic) send({ type: "set_topic", agentId: agent.id, topic: next ?? "" });
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        aria-label={t("chat.topic.edit")}
        title={t("chat.topic.clearHint")}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            save();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            saved.current = true;
            setEditing(false);
          }
        }}
        onBlur={save}
        style={{
          background: "transparent",
          border: "1px solid var(--border-medium)",
          borderRadius: 4,
          color: "var(--text-muted)",
          fontSize: 12,
          padding: "1px 6px",
          outline: "none",
          width: 200,
          minWidth: 0,
        }}
      />
    );
  }

  return (
    <>
      <span style={{ color: "var(--text-ghost)" }}>&middot;</span>
      <button
        type="button"
        aria-label={t(topic ? "chat.topic.edit" : "chat.topic.add")}
        title={t(topic ? "chat.topic.edit" : "chat.topic.add")}
        onClick={() => {
          saved.current = false;
          setDraft(topic ?? "");
          setEditing(true);
        }}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          color: topic ? "var(--text-secondary)" : "var(--text-ghost)",
          fontSize: 13,
          cursor: "text",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
      >
        {topic ?? t("chat.topic.add")}
      </button>
      <button
        type="button"
        onClick={() => send({ type: "reset_topic", agentId: agent.id })}
        disabled={generating}
        aria-label={t(generating ? "chat.topic.generating" : "chat.topic.refresh")}
        title={t(generating ? "chat.topic.generating" : "chat.topic.refresh")}
        aria-busy={generating}
        style={{
          background: "none",
          border: "none",
          cursor: generating ? "default" : "pointer",
          color: "var(--text-secondary)",
          fontSize: 15,
          padding: "0 4px",
          opacity: generating ? 0.5 : 0.8,
          lineHeight: 1,
        }}
      >
        {generating ? "…" : "↻"}
      </button>
    </>
  );
}
