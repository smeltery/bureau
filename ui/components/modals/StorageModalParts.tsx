import { STORAGE_CATEGORY_LABELS, STORAGE_CATEGORY_ORDER } from "../../../shared/storage-labels.ts";
import type { PruneApplyWire, PrunePlanWire, PruneSkipReason, PruneTarget, StorageCategoryId, StorageCategoryWire, StorageUsageWire } from "../../../shared/storage-types.ts";
import { dialogCancelBtn, dialogInput } from "./dialog-styles.ts";

export type StoragePhase =
  | { kind: "idle" }
  | { kind: "previewing" }
  | { kind: "previewed"; plan: PrunePlanWire }
  | { kind: "confirming"; plan: PrunePlanWire }
  | { kind: "applying"; plan: PrunePlanWire }
  | { kind: "done"; result: PruneApplyWire };

const TARGET_LABELS: Record<PruneTarget, string> = {
  transcripts: "Conversations",
  attachments: "Orphaned attachments",
};

const SKIP_LABELS: Record<PruneSkipReason, string> = {
  "active-session": "active sessions",
  "keep-newest": "newest conversations kept per agent",
  "fork-ancestor": "fork ancestors",
  referenced: "attachments still referenced by conversations or queues",
  "too-recent": "too recent",
};

const SAMPLE_ROWS = 4;

export function UsageBlock({ usage, error }: { usage: StorageUsageWire | null; error: string | null }) {
  if (error) return <ErrorLine>{error}</ErrorLine>;
  if (!usage) return <p style={{ fontSize: 11, color: "var(--text-ghost)", marginTop: 16 }}>Measuring...</p>;

  const byId = new Map<StorageCategoryId, StorageCategoryWire>(usage.categories.map((category) => [category.id, category]));
  return (
    <>
      <SectionLabel>What is on disk</SectionLabel>
      <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0 }}>
        <strong>{formatSize(usage.stateRootBytes)} office state</strong>
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 11 }}>
        <tbody>
          {STORAGE_CATEGORY_ORDER.map((id) => (
            <CategoryRow key={id} category={byId.get(id)} id={id} />
          ))}
        </tbody>
      </table>
    </>
  );
}

function CategoryRow({ category, id }: { category: StorageCategoryWire | undefined; id: StorageCategoryId }) {
  if (!category) return null;
  return (
    <tr>
      <td style={cell}>{STORAGE_CATEGORY_LABELS[id]}</td>
      <td style={cellRight}>{category.available ? formatSize(category.bytes) : "none"}</td>
      <td style={{ ...cellRight, color: "var(--text-ghost)" }}>{category.available ? category.files.toLocaleString() : "-"}</td>
    </tr>
  );
}

export function PlanBlock({
  plan,
  phase,
  confirmText,
  onConfirmText,
  onAskConfirm,
  onCancelConfirm,
  onApply,
}: {
  plan: PrunePlanWire;
  phase: StoragePhase;
  confirmText: string;
  onConfirmText: (value: string) => void;
  onAskConfirm: () => void;
  onCancelConfirm: () => void;
  onApply: () => void;
}) {
  const count = plan.candidates.length;
  const targetWord = TARGET_LABELS[plan.target].toLowerCase();
  return (
    <div style={planBox}>
      <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: count > 0 ? "var(--text-primary)" : "var(--text-dim)" }}>
        {count > 0 ? `${count.toLocaleString()} ${targetWord} would be deleted, freeing ${formatSize(plan.bytes)}.` : `Nothing matches. No ${targetWord} are old enough to delete.`}
      </p>
      <p style={{ margin: "4px 0 0", fontSize: 10, color: "var(--text-ghost)" }}>Nothing has been deleted yet.</p>

      {plan.skipped.length > 0 && (
        <ul style={{ margin: "8px 0 0", paddingLeft: 16, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.6 }}>
          {plan.skipped.map((skip) => (
            <li key={skip.reason}>
              {skip.count.toLocaleString()} kept ({formatSize(skip.bytes)}): {SKIP_LABELS[skip.reason]}
            </li>
          ))}
        </ul>
      )}

      {plan.candidates.slice(0, SAMPLE_ROWS).map((candidate) => (
        <div key={candidate.path} style={sampleRow}>
          {candidate.path} - {formatSize(candidate.bytes)}, {candidate.ageDays}d old
        </div>
      ))}
      {count > SAMPLE_ROWS && <div style={sampleRow}>...and {(count - SAMPLE_ROWS).toLocaleString()} more.</div>}

      {count > 0 && phase.kind === "previewed" && (
        <button onClick={onAskConfirm} style={dangerBtn}>
          Delete {count.toLocaleString()} {targetWord} permanently
        </button>
      )}

      {(phase.kind === "confirming" || phase.kind === "applying") && (
        <div style={{ marginTop: 12 }}>
          <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: "var(--text-secondary)" }}>
            <strong style={{ color: "#ff6b6b" }}>This cannot be undone.</strong> Bureau scans again before deleting, so the final count may differ from the preview.
          </p>
          <input value={confirmText} onChange={(event) => onConfirmText(event.target.value)} placeholder="Type DELETE to confirm" autoFocus style={{ ...dialogInput, marginTop: 8 }} />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={onCancelConfirm} style={{ ...dialogCancelBtn, flex: 1 }} disabled={phase.kind === "applying"}>
              Cancel
            </button>
            <button
              onClick={onApply}
              disabled={confirmText !== "DELETE" || phase.kind === "applying"}
              style={{ ...dangerBtn, marginTop: 0, flex: 1, opacity: confirmText === "DELETE" ? 1 : 0.5, cursor: confirmText === "DELETE" ? "pointer" : "not-allowed" }}
            >
              {phase.kind === "applying" ? "Deleting..." : "Delete permanently"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ResultBlock({ result }: { result: PruneApplyWire }) {
  return (
    <div style={planBox}>
      {result.aborted ? (
        <p style={{ margin: 0, fontSize: 12, color: "#ff6b6b" }}>Stopped before deleting anything: {result.aborted}</p>
      ) : (
        <p style={{ margin: 0, fontSize: 12, color: "var(--text-primary)" }}>
          Deleted {result.deleted.toLocaleString()} files, freeing {formatSize(result.bytes)}.
        </p>
      )}
      {result.refused.length > 0 && <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--text-dim)" }}>{result.refused.length.toLocaleString()} could not be removed and were left alone.</p>}
    </div>
  );
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h4 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)", margin: "20px 0 8px" }}>{children}</h4>;
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", margin: "14px 0 5px" }}>{children}</label>;
}

export function ErrorLine({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 11, color: "#ff6b6b", margin: "8px 0 0", lineHeight: 1.5 }}>{children}</p>;
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const planBox: React.CSSProperties = { marginTop: 14, border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", background: "var(--bg-input)" };
const sampleRow: React.CSSProperties = { marginTop: 6, fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "var(--text-ghost)", lineHeight: 1.5, wordBreak: "break-all" };
const cell: React.CSSProperties = { padding: "3px 0", color: "var(--text-secondary)", borderBottom: "1px solid var(--border-subtle)" };
const cellRight: React.CSSProperties = { ...cell, textAlign: "right", fontFamily: "'JetBrains Mono',monospace" };
const dangerBtn: React.CSSProperties = {
  marginTop: 12,
  width: "100%",
  padding: "9px 16px",
  borderRadius: 8,
  border: "1px solid #ff6b6b",
  background: "rgba(255,107,107,0.15)",
  color: "#ff6b6b",
  fontSize: 12,
  fontWeight: 700,
  cursor: "pointer",
};
