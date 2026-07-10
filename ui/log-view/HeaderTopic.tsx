import { useRef, useState } from "react";
import type { AgentInfo } from "../../shared/types.ts";
import { send } from "../ws.ts";

export function HeaderTopic({ agent }: { agent: AgentInfo }) {
  const [editingTopic, setEditingTopic] = useState(false);
  const [topicDraft, setTopicDraft] = useState("");
  const topicInputRef = useRef<HTMLInputElement>(null);
  const topicSavedRef = useRef(false);

  if (agent.topic && agent.topic !== "..." && !editingTopic) {
    return (
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
    );
  }

  if (agent.topic === "...") {
    return (
      <>
        <span style={{ color: "var(--text-ghost)" }}>&middot;</span>
        <span style={{ color: "var(--text-ghost)", fontSize: 13 }}>...</span>
      </>
    );
  }

  if (!editingTopic) {
    return null;
  }

  return (
    <input
      ref={topicInputRef}
      value={topicDraft}
      onChange={(e) => setTopicDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          saveTopic(agent, topicDraft);
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
        saveTopic(agent, topicDraft);
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
  );
}

function saveTopic(agent: AgentInfo, topicDraft: string) {
  const trimmed = topicDraft.trim();
  if (trimmed && trimmed !== agent.topic) {
    send({ type: "set_topic", agentId: agent.id, topic: trimmed });
  }
}
