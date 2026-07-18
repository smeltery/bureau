import type { AgentContextUsageSnapshot } from "../../../shared/types.ts";

export function ContextMeter({ usage }: { usage?: AgentContextUsageSnapshot | null }) {
  if (!usage) return null;
  const pct = Math.max(0, Math.min(100, usage.percentage));
  const remaining = Math.max(0, 100 - pct);
  const tone = pct >= 75 ? "var(--red)" : pct >= 50 ? "var(--orange, #F5A623)" : "var(--text-muted)";
  return (
    <span
      title={`${usage.model}: ${usage.totalTokens.toLocaleString()} / ${usage.maxTokens.toLocaleString()} tokens used (${Math.round(pct)}% full, ${Math.round(remaining)}% left)`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color: tone,
        fontFamily: "'JetBrains Mono',monospace",
        fontSize: 11,
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 22,
          height: 10,
          border: "1px solid currentColor",
          borderRadius: 3,
          padding: 1,
          display: "inline-flex",
          alignItems: "stretch",
          opacity: 0.9,
        }}
      >
        <span
          style={{
            width: `${100 - pct}%`,
            minWidth: remaining > 0 ? 2 : 0,
            borderRadius: 1,
            background: "currentColor",
            opacity: 0.85,
          }}
        />
      </span>
      {Math.round(remaining)}%
    </span>
  );
}
