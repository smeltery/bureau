import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Attachment } from "../../../shared/types.ts";
import { isApiTokenDevice } from "../../../shared/identity.ts";
import { CopyButton } from "../../components/controls/CopyButton.tsx";
import { EditIcon } from "../../components/controls/Icons.tsx";
import { AttachmentDisplay } from "./shared.tsx";

export function UserMessage({
  content,
  isMobile,
  username,
  device,
  agentName,
  agentRoom,
  cronjobName,
  fromNonHuman,
  outgoing,
  attachments,
  agentId,
  canEdit,
  onEdit,
}: {
  content: string;
  isMobile?: boolean;
  username?: string;
  device?: string;
  agentName?: string;
  agentRoom?: string;
  cronjobName?: string;
  fromNonHuman?: boolean;
  outgoing?: boolean;
  attachments?: Attachment[];
  agentId?: string;
  canEdit?: boolean;
  onEdit?: () => void;
}) {
  const getText = useCallback(() => content, [content]);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  // Programmatic senders get a distinct dashed treatment so they don't read as
  // the human's own typing. Mirrors QueueChips for queued programmatic messages.
  const sender = describeUserMessageSender({ username, device, agentName, agentRoom, cronjobName });
  const fromHuman = sender.fromHuman && !fromNonHuman;
  const edge = `3px ${fromHuman ? "solid" : "dashed"} ${fromHuman ? "var(--accent)" : "var(--text-muted)"}`;
  return (
    <div
      style={{
        margin: outgoing ? "12px 0 12px 18px" : "12px 0",
        padding: "10px 14px",
        paddingRight: 40,
        borderRadius: 10,
        background: "var(--user-msg-bg)",
        ...(outgoing ? { borderRight: edge } : { borderLeft: edge }),
        position: "relative",
      }}
    >
      <div style={{ fontSize: isMobile ? 12 : 10, fontWeight: 600, color: fromHuman ? "var(--accent)" : "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {sender.label.toUpperCase()}
      </div>
      {content && (
        <div
          style={{
            color: "var(--text-secondary)",
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: isMobile ? 15 : 13,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            overflowWrap: "break-word",
            wordBreak: "break-word",
          }}
        >
          {content}
        </div>
      )}
      {attachments && attachments.length > 0 && agentId && (
        <AttachmentDisplay attachments={attachments} agentId={agentId} isMobile={isMobile} lightboxSrc={lightboxSrc} setLightboxSrc={setLightboxSrc} hasContent={!!content} />
      )}
      <div style={{ position: "absolute", top: 8, right: 8, display: "flex", gap: 4 }}>
        {canEdit && onEdit && (
          <button
            onClick={onEdit}
            title="Edit & branch"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "var(--text-ghost)",
              padding: 2,
              borderRadius: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-ghost)")}
          >
            <EditIcon />
          </button>
        )}
        <CopyButton getText={getText} />
      </div>
    </div>
  );
}

export function describeUserMessageSender({
  username,
  device,
  agentName,
  agentRoom,
  cronjobName,
}: {
  username?: string;
  device?: string;
  agentName?: string;
  agentRoom?: string;
  cronjobName?: string;
}): {
  label: string;
  fromHuman: boolean;
} {
  if (agentName) return { label: `${agentName} · agent · Room "${agentRoom ?? "?"}"`, fromHuman: false };
  if (cronjobName) return { label: `${cronjobName} · cron job`, fromHuman: false };
  const label = username ? (device ? `${username} (${device})` : username) : (device ?? "You");
  return { label, fromHuman: !isApiTokenDevice(device) };
}

export function EditableUserMessage({
  content,
  entryId,
  isMobile,
  username,
  onCancel,
  onSubmit,
}: {
  content: string;
  entryId: string;
  isMobile?: boolean;
  username?: string;
  onCancel?: () => void;
  onSubmit?: (entryId: string, newText: string) => void;
}) {
  const [text, setText] = useState(content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Use `pointer: coarse` instead of the viewport-based `isMobile` prop so
  // narrow desktop windows (split-screen) with a hardware keyboard still
  // send on Enter, matching the main composer in LogView.tsx.
  const isTouchPrimary = useMemo(() => typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches, []);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !isTouchPrimary) {
      e.preventDefault();
      if (text.trim()) onSubmit?.(entryId, text.trim());
    }
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel?.();
    }
  }

  return (
    <div
      style={{
        margin: "12px 0",
        padding: "10px 14px",
        borderRadius: 10,
        background: "var(--user-msg-bg)",
        borderLeft: "3px solid var(--accent)",
        position: "relative",
      }}
    >
      <div style={{ fontSize: isMobile ? 12 : 10, fontWeight: 600, color: "var(--accent)", marginBottom: 4, fontFamily: "'DM Sans',sans-serif", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {(username ?? "You").toUpperCase()}
      </div>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = e.target.scrollHeight + "px";
        }}
        onKeyDown={handleKeyDown}
        style={{
          width: "100%",
          resize: "none",
          border: "1px solid var(--accent)",
          borderRadius: 6,
          padding: "8px 10px",
          fontSize: isMobile ? 15 : 13,
          fontFamily: "'JetBrains Mono',monospace",
          lineHeight: 1.6,
          background: "var(--bg-base)",
          color: "var(--text-secondary)",
          outline: "none",
          minHeight: 40,
          boxSizing: "border-box",
        }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
        <button
          onClick={onCancel}
          style={{
            padding: "4px 14px",
            borderRadius: 6,
            border: "1px solid var(--border-medium)",
            background: "transparent",
            color: "var(--text-muted)",
            fontSize: isMobile ? 14 : 12,
            fontFamily: "'DM Sans',sans-serif",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => text.trim() && onSubmit?.(entryId, text.trim())}
          style={{
            padding: "4px 14px",
            borderRadius: 6,
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            fontSize: isMobile ? 14 : 12,
            fontFamily: "'DM Sans',sans-serif",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
