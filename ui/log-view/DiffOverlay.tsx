import { useEffect } from "react";
import type { DiffFileSummary } from "../../shared/types.ts";
import { CopyButton } from "../components/controls/CopyButton.tsx";
import { DiffRenderer, type DiffOutputFormat } from "./DiffRenderer.tsx";
import { FilePath, PlusMinus, StatusBadge } from "./DiffFileBits.tsx";

export function DiffOverlay({
  summary,
  patch,
  outputFormat,
  truncated,
  onClose,
}: {
  summary: DiffFileSummary;
  patch: string | null;
  outputFormat: DiffOutputFormat;
  truncated: boolean;
  onClose: () => void;
}) {
  // Intercept ESC at capture phase so the global window-level handler in
  // App.tsx (which navigates back to the room view) doesn't fire.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey, true);
    return () => window.removeEventListener("keydown", handleKey, true);
  }, [onClose]);

  const reason = truncated
    ? "The total patch was over 2 MB so the diff content was not shipped to the browser. Re-run /bureau-diff after narrowing the working tree, or open this file in your editor."
    : summary.status === "binary"
      ? "Binary file — no textual diff to render."
      : summary.status === "untracked"
        ? "Untracked file too large to synthesize a patch (>1 MB). Open in your editor, or `git add` it and re-run."
        : !patch
          ? "No patch content for this file."
          : null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "default",
      }}
    >
      <div
        style={{
          width: "min(95vw, 1400px)",
          height: "min(92vh, 1000px)",
          background: "var(--bg-surface-solid)",
          border: "1px solid var(--border-medium)",
          borderRadius: 10,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "10px 14px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            gap: 10,
            background: "var(--bg-overlay-solid)",
          }}
        >
          <StatusBadge status={summary.status} />
          <span
            style={{
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: 13,
              color: "var(--text-secondary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
          >
            <FilePath summary={summary} />
          </span>
          <PlusMinus additions={summary.additions} deletions={summary.deletions} />
          {patch && <CopyButton getText={() => patch} />}
          <button
            onClick={onClose}
            title="Close (Esc)"
            style={{
              background: "transparent",
              border: "1px solid var(--border-medium)",
              color: "var(--text-dim)",
              borderRadius: 6,
              padding: "4px 10px",
              fontSize: 12,
              fontFamily: "'DM Sans',sans-serif",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
          {reason && (
            <div
              style={{
                padding: "12px 16px",
                color: "var(--text-dim)",
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 13,
                background: "var(--bg-subtle)",
                border: "1px dashed var(--border-medium)",
                borderRadius: 8,
              }}
            >
              {reason}
            </div>
          )}
          {!reason && patch && <DiffRenderer patchText={patch} outputFormat={outputFormat} />}
        </div>
      </div>
    </div>
  );
}
