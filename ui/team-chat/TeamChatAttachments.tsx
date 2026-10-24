import type { Attachment } from "../../shared/log-types.ts";

export function TeamChatAttachments({ attachments }: { attachments: Attachment[] }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
      {attachments.map((attachment, index) => {
        const href = "/api/members-chat/files/" + encodeURIComponent(attachment.filename);
        return (
          <a key={attachment.filename + index} href={href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", maxWidth: "100%", overflowWrap: "anywhere" }}>
            {attachment.mediaType.startsWith("image/") ? (
              <img loading="lazy" src={href} alt={attachment.originalName} style={{ display: "block", maxWidth: "100%", maxHeight: 240, borderRadius: 6 }} />
            ) : (
              <>📎 {attachment.originalName}</>
            )}
          </a>
        );
      })}
    </div>
  );
}
