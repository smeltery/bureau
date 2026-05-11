import type { FilePayload } from "../../shared/types.ts";

function FileIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 1.5H4A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8A1.5 1.5 0 0 0 13.5 13V6L9 1.5z" />
      <path d="M9 1.5V6h4.5" />
    </svg>
  );
}

export function EditRequestCard({ payload, onOpen }: { payload: FilePayload; onOpen: (path: string) => void }) {
  // Render a relative-looking suffix (the basename + parent) so the boss
  // sees what they're opening without the wall of absolute path noise.
  const parts = payload.path.split("/");
  const tail = parts.slice(-2).join("/");
  return (
    <div
      style={{
        margin: "8px 0",
        borderRadius: 10,
        background: "var(--bg-subtle)",
        border: "1px solid var(--border)",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ color: "var(--text-ghost)", display: "inline-flex" }}>
          <FileIcon />
        </span>
        <span
          style={{
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 13,
            color: "var(--text-secondary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flex: 1,
            minWidth: 0,
          }}
          title={payload.path}
        >
          {tail}
        </span>
        <button
          onClick={() => onOpen(payload.path)}
          style={{
            padding: "4px 12px",
            borderRadius: 6,
            border: "1px solid var(--green-border)",
            background: "var(--green-bg)",
            color: "var(--green)",
            fontSize: 12,
            fontFamily: "'JetBrains Mono',monospace",
            cursor: "pointer",
            flexShrink: 0,
          }}
          title="Open this file in the editor side panel"
        >
          Open in editor
        </button>
      </div>
    </div>
  );
}
