import type { DiffFileSummary } from "../../shared/types.ts";

export function StatusBadge({ status }: { status: DiffFileSummary["status"] }) {
  const palette: Record<DiffFileSummary["status"], { fg: string; bg: string; label: string }> = {
    added: { fg: "var(--green)", bg: "var(--green-bg)", label: "added" },
    modified: { fg: "var(--accent)", bg: "var(--accent-bg)", label: "modified" },
    deleted: { fg: "var(--red)", bg: "var(--red-bg)", label: "deleted" },
    renamed: { fg: "var(--purple)", bg: "rgba(155,109,255,0.10)", label: "renamed" },
    copied: { fg: "var(--purple)", bg: "rgba(155,109,255,0.10)", label: "copied" },
    untracked: { fg: "var(--orange)", bg: "var(--orange-bg)", label: "untracked" },
    binary: { fg: "var(--text-muted)", bg: "var(--bg-hover)", label: "binary" },
  };
  const p = palette[status];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 6px",
        borderRadius: 4,
        background: p.bg,
        color: p.fg,
        fontSize: 10,
        fontFamily: "'JetBrains Mono',monospace",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        flexShrink: 0,
      }}
    >
      {p.label}
    </span>
  );
}

export function PlusMinus({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 6, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, flexShrink: 0 }}>
      {additions > 0 && <span style={{ color: "var(--green)" }}>+{additions}</span>}
      {deletions > 0 && <span style={{ color: "var(--red)" }}>-{deletions}</span>}
    </span>
  );
}

export function FilePath({ summary }: { summary: DiffFileSummary }) {
  if (summary.oldPath && summary.oldPath !== summary.path) {
    return (
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <span style={{ color: "var(--text-muted)" }}>{summary.oldPath}</span>
        <span style={{ color: "var(--text-faint)", margin: "0 6px" }}>→</span>
        <span>{summary.path}</span>
      </span>
    );
  }
  return <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary.path}</span>;
}
