import { discardAttempt, resendAttempt, useOutbox, type OutboxAttempt } from "./index.ts";

export function OutboxRows({ agentId, isMobile, onEdit }: { agentId: string; isMobile?: boolean; onEdit: (id: string) => void }) {
  const attempts = useOutbox(agentId);
  if (attempts.length === 0) return null;

  const reason = (attempt: OutboxAttempt): string | null => {
    if (!attempt.error) return null;
    if (attempt.error.kind === "network") return "Network error";
    if (attempt.error.kind === "interrupted") return "Reloaded before Bureau confirmed this message.";
    return attempt.error.message;
  };

  const button = (danger?: boolean) => ({
    padding: "2px 10px",
    borderRadius: 4,
    border: `1px solid ${danger ? "var(--border-medium)" : "var(--accent)"}`,
    background: "none",
    color: danger ? "var(--text-muted)" : "var(--accent-text)",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
  });

  return (
    <div data-outbox style={{ display: "flex", flexDirection: "column", gap: 6, margin: "0 11px 8px", maxHeight: isMobile ? 200 : 240, overflowY: "auto" }}>
      {attempts.map((attempt) => {
        const failed = attempt.status === "failed";
        const why = reason(attempt);
        const attachmentCount = attempt.attachments?.length ?? 0;
        return (
          <div
            key={attempt.id}
            data-outbox-attempt={attempt.status}
            role={failed ? "alert" : "status"}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              background: failed ? "var(--red-bg, rgba(192,57,43,0.12))" : "var(--bg-hover)",
              border: `1px solid ${failed ? "var(--red, #c0392b)" : "var(--border-medium)"}`,
              fontSize: isMobile ? 13 : 12,
              fontFamily: "'JetBrains Mono',monospace",
              color: "var(--text-secondary)",
            }}
          >
            <div style={{ fontSize: isMobile ? 11 : 10, fontWeight: 600, color: failed ? "var(--red-text)" : "var(--text-muted)", marginBottom: 2, textTransform: "uppercase" }}>
              {failed ? "Not sent" : "Sending..."}
            </div>
            {attempt.text && <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", lineHeight: 1.4, maxHeight: isMobile ? "4.2em" : "3.5em", overflow: "hidden" }}>{attempt.text}</div>}
            {attachmentCount > 0 && (
              <div style={{ fontSize: isMobile ? 11 : 10, color: "var(--text-muted)", marginTop: attempt.text ? 4 : 0, fontStyle: "italic" }}>
                {attachmentCount} attachment{attachmentCount === 1 ? "" : "s"}
              </div>
            )}
            {failed && (
              <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 6 }}>
                {why && <span style={{ flex: 1, minWidth: 0, fontSize: isMobile ? 12 : 11, color: "var(--red-text)" }}>{why}</span>}
                <button style={button()} onClick={() => resendAttempt(attempt.id)}>
                  Resend
                </button>
                <button style={button()} onClick={() => onEdit(attempt.id)}>
                  Edit
                </button>
                <button style={button(true)} onClick={() => discardAttempt(attempt.id)}>
                  Discard
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
