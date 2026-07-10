import { sendAbortDebounced } from "../utils/abort.ts";

export function MobileInputAction({
  agentId,
  input,
  validAttachmentCount,
  hasUploading,
  editingLogEntryId,
  isBusy,
  onSend,
}: {
  agentId: string;
  input: string;
  validAttachmentCount: number;
  hasUploading: boolean;
  editingLogEntryId: string | null;
  isBusy: boolean;
  onSend: () => void;
}) {
  if (isBusy) {
    return (
      <button
        onClick={() => sendAbortDebounced(agentId)}
        style={{
          flexShrink: 0,
          alignSelf: "flex-end",
          width: 36,
          height: 36,
          borderRadius: 8,
          border: "1px solid var(--red)",
          background: "transparent",
          color: "var(--red)",
          fontSize: 16,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          lineHeight: 1,
        }}
        title="Abort"
      >
        ■
      </button>
    );
  }

  const canSend = (input.trim() || validAttachmentCount > 0) && !hasUploading && !editingLogEntryId;

  return (
    <button
      onClick={onSend}
      disabled={!canSend}
      style={{
        flexShrink: 0,
        alignSelf: "flex-end",
        width: 36,
        height: 36,
        borderRadius: 8,
        border: "none",
        background: canSend ? "var(--green)" : "var(--bg-hover)",
        color: canSend ? "var(--bg-base)" : "var(--text-ghost)",
        fontSize: 16,
        cursor: canSend ? "pointer" : "default",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        lineHeight: 1,
        transition: "background 0.15s, color 0.15s",
      }}
      title="Send"
    >
      ▲
    </button>
  );
}
