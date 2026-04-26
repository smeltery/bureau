import { useEffect, useState } from "react";
import type { AgentState } from "../../shared/types.ts";
import { send } from "../ws.ts";
import { ESCALATION_AMBER_MS, escalationColor, formatElapsed } from "../utils/time.ts";

export const STATE_LABELS: Partial<Record<AgentState, string>> = {
  thinking: "Thinking",
  tool_executing: "Running tool",
};

/**
 * Shown at the bottom of the messages pane whenever the agent is working.
 * After 2 minutes the color escalates to amber and an Abort button appears;
 * after 5 minutes it turns red.
 */
export function ActivityIndicator({ state, stateChangedAt, agentId }: { state: AgentState; stateChangedAt?: number; agentId: string }) {
  const label = STATE_LABELS[state];
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!label) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [label]);

  if (!label) return null;

  const elapsedMs = stateChangedAt ? now - stateChangedAt : 0;
  const baseColor = state === "waiting_for_response" ? "var(--purple)" : "var(--green)";
  const color = escalationColor(elapsedMs, baseColor);
  const showAbort = elapsedMs >= ESCALATION_AMBER_MS;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "12px 14px",
        margin: "8px 0",
        color,
        fontSize: 12,
        animation: "fadeIn 0.2s ease-out",
      }}
    >
      <span style={{ display: "inline-flex", gap: 3 }}>
        <span style={{ width: 4, height: 4, borderRadius: "50%", background: color, animation: "dotBounce 1.4s ease-in-out infinite", animationDelay: "0s" }} />
        <span style={{ width: 4, height: 4, borderRadius: "50%", background: color, animation: "dotBounce 1.4s ease-in-out infinite", animationDelay: "0.2s" }} />
        <span style={{ width: 4, height: 4, borderRadius: "50%", background: color, animation: "dotBounce 1.4s ease-in-out infinite", animationDelay: "0.4s" }} />
      </span>
      <span>{label}...</span>
      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, opacity: 0.7 }}>{formatElapsed(elapsedMs)}</span>
      {showAbort && (
        <button
          onClick={() => send({ type: "abort", agentId })}
          style={{
            marginLeft: 8,
            padding: "2px 10px",
            borderRadius: 4,
            border: `1px solid ${color}`,
            background: "transparent",
            color,
            fontSize: 11,
            cursor: "pointer",
            opacity: 0.8,
          }}
        >
          Abort
        </button>
      )}
    </div>
  );
}

/** Inline state + elapsed timer shown next to the agent name in the header. */
export function HeaderTimer({ state, stateChangedAt }: { state: AgentState; stateChangedAt?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);
  const elapsedMs = stateChangedAt ? now - stateChangedAt : 0;
  const baseColor = state === "waiting_for_response" ? "var(--purple)" : "var(--green)";
  const color = escalationColor(elapsedMs, baseColor);
  return (
    <>
      <span style={{ color: "var(--text-ghost)" }}>&middot;</span>
      <span style={{ color, fontSize: 12 }}>
        {STATE_LABELS[state]} {formatElapsed(elapsedMs)}
      </span>
    </>
  );
}
