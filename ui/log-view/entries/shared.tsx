import { useCallback } from "react";
import type { Attachment, LogEntry } from "../../../shared/types.ts";
import { CopyButton } from "../../components/controls/CopyButton.tsx";
import { formatDuration } from "../../utils/time.ts";
import { formatFileSize } from "../../utils/format.ts";
import { serializeEntries } from "./serialize.ts";

export function FileChip({ att, agentId, isMobile }: { att: Attachment; agentId: string; isMobile?: boolean }) {
  const isPdf = att.mediaType === "application/pdf";
  const icon = isPdf ? "📄" : "📎";
  const sizeStr = formatFileSize(att.size);
  const href = `/api/files/${agentId}/${att.filename}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 6,
        background: "var(--bg-hover)",
        border: "1px solid var(--border)",
        color: "var(--text-secondary)",
        fontSize: isMobile ? 13 : 11,
        fontFamily: "'JetBrains Mono',monospace",
        textDecoration: "none",
        cursor: "pointer",
        maxWidth: "100%",
      }}
    >
      <span>{icon}</span>
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{att.originalName}</span>
      {sizeStr && <span style={{ color: "var(--text-ghost)", flexShrink: 0 }}>{sizeStr}</span>}
    </a>
  );
}

export function AttachmentDisplay({
  attachments,
  agentId,
  isMobile,
  lightboxSrc,
  setLightboxSrc,
  hasContent,
}: {
  attachments: Attachment[];
  agentId: string;
  isMobile?: boolean;
  lightboxSrc: string | null;
  setLightboxSrc: (src: string | null) => void;
  hasContent?: boolean;
}) {
  const images = attachments.filter((a) => a.mediaType.startsWith("image/"));
  const files = attachments.filter((a) => !a.mediaType.startsWith("image/"));

  return (
    <>
      {images.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: hasContent ? 8 : 0 }}>
          {images.map((att) => {
            const src = `/api/files/${agentId}/${att.filename}`;
            return (
              <img
                key={att.filename}
                src={src}
                alt={att.originalName}
                onClick={() => setLightboxSrc(src)}
                style={{
                  maxWidth: isMobile ? "100%" : 300, maxHeight: 200, borderRadius: 4,
                  cursor: "pointer", border: "1px solid var(--green-border)",
                }}
              />
            );
          })}
        </div>
      )}
      {files.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: hasContent || images.length > 0 ? 8 : 0 }}>
          {files.map((att) => (
            <FileChip key={att.filename} att={att} agentId={agentId} isMobile={isMobile} />
          ))}
        </div>
      )}
      {lightboxSrc && (
        <div
          tabIndex={0}
          ref={(el) => el?.focus()}
          onClick={() => setLightboxSrc(null)}
          onKeyDown={(e) => e.key === "Escape" && setLightboxSrc(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 9999,
            background: "rgba(0,0,0,0.85)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "zoom-out",
          }}
        >
          <img src={lightboxSrc} alt="Full size" style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 8 }} />
        </div>
      )}
    </>
  );
}

export function DurationLabel({ ms, isMobile }: { ms: number; isMobile?: boolean }) {
  return (
    <span style={{
      marginLeft: "auto",
      fontSize: isMobile ? 12 : 10,
      fontFamily: "'JetBrains Mono',monospace",
      color: "var(--text-ghost)",
      flexShrink: 0,
    }}>
      {formatDuration(ms)}
    </span>
  );
}

export function TurnCopyButton({ turnEntries }: { turnEntries?: LogEntry[] }) {
  const getText = useCallback(
    () => (turnEntries ? serializeEntries(turnEntries) : ""),
    [turnEntries],
  );
  if (!turnEntries) return null;
  return (
    <div style={{ position: "absolute", top: 8, right: 8 }}>
      <CopyButton getText={getText} />
    </div>
  );
}
