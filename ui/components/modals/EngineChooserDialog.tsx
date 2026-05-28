import type { AgentBackendType } from "../../../shared/types.ts";

type Props = {
  onPick: (agentType: AgentBackendType) => void;
  onCancel: () => void;
};

const OPTIONS: Array<{ agentType: AgentBackendType; label: string; blurb: string; accent: string }> = [
  { agentType: "claude", label: "Claude", blurb: "Uses your Claude Code login.", accent: "rgba(100,160,255,0.85)" },
  { agentType: "codex", label: "Codex", blurb: "Uses your ChatGPT subscription or OPENAI_API_KEY.", accent: "rgba(120,220,160,0.85)" },
];

export function EngineChooserDialog({ onPick, onCancel }: Props) {
  return (
    <div onClick={onCancel} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-overlay)", border: "1px solid var(--border-light)", borderRadius: 8, padding: 20, width: 460, maxWidth: "90vw", boxShadow: "0 20px 60px var(--shadow-heavy)" }}>
        <h3 style={{ margin: 0, marginBottom: 4, fontSize: 17, fontWeight: 700, color: "var(--text-primary)" }}>Spawn an agent</h3>
        <p style={{ margin: 0, marginBottom: 16, fontSize: 12, color: "var(--text-muted)" }}>Pick the engine. This is fixed for the agent.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {OPTIONS.map((opt) => (
            <button key={opt.agentType} onClick={() => onPick(opt.agentType)} style={{ background: "var(--bg-surface)", border: `2px solid ${opt.accent}`, borderRadius: 8, padding: "12px 14px", textAlign: "left", cursor: "pointer", color: "var(--text-primary)" }}>
              <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>+ New {opt.label} Agent</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>{opt.blurb}</div>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button onClick={onCancel} style={{ background: "transparent", border: "1px solid var(--border-medium)", borderRadius: 6, padding: "6px 14px", fontSize: 13, color: "var(--text-muted)", cursor: "pointer" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
