import { useEffect, useState } from "react";
import { Portal } from "../../components/Portal.tsx";
import { cardActionBtn, dialogCancelBtn, dialogSaveBtn } from "../../components/modals/dialog-styles.ts";
import { copyText } from "../../utils/clipboard.ts";
import { Markdown } from "../Markdown.tsx";

export function HelpCard({ header, helpContent }: { header: string; helpContent: string }) {
  return <PromptInspectCard header={header} content={helpContent} actionLabel="Show help" modalTitle="Help" renderAs="markdown" />;
}

export function PromptInspectCard({
  header,
  content,
  actionLabel,
  modalTitle,
  renderAs = "markdown",
}: {
  header: string;
  content: string;
  actionLabel: string;
  modalTitle: string;
  renderAs?: "markdown" | "plaintext";
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <>
      <div
        style={{
          margin: "8px 0",
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg-subtle)",
          color: "var(--text-dim)",
          fontSize: 12,
        }}
      >
        <span style={{ fontWeight: 600, color: "var(--text-secondary)" }}>{header.replace(/^\*\*|\*\*$/g, "")}</span>
        <button type="button" onClick={() => setOpen(true)} style={cardActionBtn}>
          {actionLabel}
        </button>
      </div>
      {open && (
        <PromptInspectModal
          title={modalTitle}
          content={content}
          renderAs={renderAs}
          copied={copied}
          onCopy={async () => {
            if (!(await copyText(content))) return;
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function PromptInspectModal({
  title,
  content,
  renderAs,
  copied,
  onCopy,
  onClose,
}: {
  title: string;
  content: string;
  renderAs: "markdown" | "plaintext";
  copied: boolean;
  onCopy: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    }
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [onClose]);

  return (
    <Portal>
      <div
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
          background: "rgba(0,0,0,0.62)",
        }}
      >
        <section
          role="dialog"
          aria-modal="true"
          aria-label={title}
          style={{
            width: "min(900px, 100%)",
            maxHeight: "min(760px, calc(100dvh - 40px))",
            display: "flex",
            flexDirection: "column",
            gap: 14,
            padding: 20,
            border: "1px solid var(--border-light)",
            borderRadius: 12,
            background: "var(--bg-overlay)",
            boxShadow: "0 20px 60px var(--shadow-heavy)",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 17, color: "var(--text-primary)" }}>{title}</h3>
          <div
            aria-readonly="true"
            style={{
              minHeight: 220,
              margin: 0,
              overflow: "auto",
              color: "var(--text-primary)",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            {renderAs === "plaintext" ? (
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}>{content}</pre>
            ) : (
              <Markdown content={content} />
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button type="button" onClick={onCopy} style={dialogSaveBtn}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" onClick={onClose} style={dialogCancelBtn}>
              Close
            </button>
          </div>
        </section>
      </div>
    </Portal>
  );
}
