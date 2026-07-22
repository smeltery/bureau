import type { AgentContextUsageSnapshot } from "../../../shared/types.ts";

export function contextMeterColor(percentage: number | null | undefined): string {
  if (percentage === null || percentage === undefined) return "var(--text-ghost)";
  if (percentage >= 75) return "var(--red)";
  if (percentage >= 50) return "var(--orange)";
  return "var(--text-muted)";
}

export function contextMeterView(usage?: AgentContextUsageSnapshot | null): { color: string; label: string; title: string; remaining: number } {
  if (!usage) {
    return {
      color: contextMeterColor(null),
      label: "?",
      remaining: 0,
      title: "Context usage not measured yet. It updates when the agent finishes a turn.",
    };
  }
  const pct = Math.max(0, Math.min(100, usage.percentage));
  const remaining = Math.max(0, 100 - pct);
  return {
    color: contextMeterColor(pct),
    label: `${Math.round(remaining)}%`,
    remaining,
    title: `${usage.model}: ${usage.totalTokens.toLocaleString()} / ${usage.maxTokens.toLocaleString()} tokens used (${Math.round(pct)}% full, ${Math.round(remaining)}% left)`,
  };
}

export function ContextMeter({ usage }: { usage?: AgentContextUsageSnapshot | null }) {
  const view = contextMeterView(usage);
  return (
    <span
      title={view.title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color: view.color,
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
            width: `${view.remaining}%`,
            minWidth: view.remaining > 0 ? 2 : 0,
            borderRadius: 1,
            background: "currentColor",
            opacity: 0.85,
          }}
        />
      </span>
      {view.label}
    </span>
  );
}
