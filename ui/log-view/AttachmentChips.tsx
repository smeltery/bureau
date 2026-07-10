import type { StagedAttachment } from "./hooks/useAttachmentUpload.ts";

interface AttachmentChipsProps {
  stagedAttachments: StagedAttachment[];
  isMobile: boolean;
  removeStaged: (id: string) => void;
}

export function AttachmentChips({ stagedAttachments, isMobile, removeStaged }: AttachmentChipsProps) {
  if (stagedAttachments.length === 0) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
      {stagedAttachments.map((att) => (
        <div
          key={att.id}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 8px",
            borderRadius: 6,
            background: att.error ? "var(--red-bg)" : "var(--bg-hover)",
            border: `1px solid ${att.error ? "var(--red)" : "var(--border)"}`,
            fontSize: isMobile ? 13 : 11,
            fontFamily: "'JetBrains Mono',monospace",
            color: att.error ? "var(--red)" : "var(--text-secondary)",
            maxWidth: "100%",
          }}
        >
          {att.mediaType.startsWith("image/") ? "🖼️" : att.mediaType === "application/pdf" ? "📄" : "📎"}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>{att.originalName}</span>
          {att.uploading && <span style={{ color: "var(--text-ghost)" }}>uploading…</span>}
          {att.error && <span style={{ fontSize: isMobile ? 11 : 9 }}>{att.error}</span>}
          <button
            onClick={() => removeStaged(att.id)}
            style={{
              background: "none",
              border: "none",
              color: att.error ? "var(--red)" : "var(--text-ghost)",
              cursor: "pointer",
              padding: "0 2px",
              fontSize: 14,
              lineHeight: 1,
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
