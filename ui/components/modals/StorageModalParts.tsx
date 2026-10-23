import { STORAGE_CATEGORY_ORDER } from "../../../shared/storage-labels.ts";
import type { PruneApplyWire, PrunePlanWire, PruneSkipReason, PruneTarget, StorageCategoryId, StorageCategoryWire, StorageUsageWire } from "../../../shared/storage-types.ts";
import { dialogCancelBtn, dialogInput } from "./dialog-styles.ts";
import { useI18n } from "../../i18n.tsx";
import type { PlainMessageKey } from "../../../shared/i18n/translate.ts";
import { formatSize } from "../../../shared/format/human.ts";

export type StoragePhase =
  | { kind: "idle" }
  | { kind: "previewing" }
  | { kind: "previewed"; plan: PrunePlanWire }
  | { kind: "confirming"; plan: PrunePlanWire }
  | { kind: "applying"; plan: PrunePlanWire }
  | { kind: "done"; result: PruneApplyWire };

export interface BackupStatusWire {
  lastRunAt: number | null;
  ok: boolean;
  error: string | null;
  retention: number;
  destDir: string;
}

const TARGET_LABELS: Record<PruneTarget, PlainMessageKey> = {
  transcripts: "storage.target.transcripts",
  attachments: "storage.target.attachments",
  "token-logs": "storage.target.tokenLogs",
  "terminal-recordings": "storage.target.recordings",
};

const SKIP_LABELS: Record<PruneSkipReason, PlainMessageKey> = {
  "active-session": "storage.skip.activeSession",
  "active-recording": "storage.skip.activeRecording",
  "keep-newest": "storage.skip.keepNewest",
  "fork-ancestor": "storage.skip.forkAncestor",
  referenced: "storage.skip.referenced",
  "too-recent": "storage.skip.tooRecent",
};

const CATEGORY_LABELS: Record<StorageCategoryId, PlainMessageKey> = {
  transcripts: "logs.report.transcripts",
  attachments: "logs.report.attachments",
  metadata: "logs.report.metadata",
  "codex-home": "logs.report.codexHome",
  cronjobs: "logs.report.cronjobs",
  memory: "logs.report.memory",
  "other-state": "logs.report.otherState",
  backups: "logs.report.backups",
  "token-logs": "logs.report.tokenLogs",
  "terminal-recordings": "logs.report.recordings",
};

const SAMPLE_ROWS = 4;

export function UsageBlock({ usage, error }: { usage: StorageUsageWire | null; error: string | null }) {
  const { t, language } = useI18n();
  if (error) return <ErrorLine>{error}</ErrorLine>;
  if (!usage) return <p style={{ fontSize: 11, color: "var(--text-ghost)", marginTop: 16 }}>{t("storage.measuring")}</p>;

  const byId = new Map<StorageCategoryId, StorageCategoryWire>(usage.categories.map((category) => [category.id, category]));
  return (
    <>
      <SectionLabel>{t("storage.diskTitle")}</SectionLabel>
      <p style={{ fontSize: 12, color: "var(--text-secondary)", margin: 0 }}>
        <strong>{t("storage.officeState", { size: formatSize(usage.stateRootBytes, language) })}</strong>
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
  const { t, language } = useI18n();
  if (!category) return null;
  return (
    <tr>
      <td style={cell}>{t(CATEGORY_LABELS[id])}</td>
      <td style={cellRight}>{category.available ? formatSize(category.bytes, language) : t("common.none")}</td>
      <td style={{ ...cellRight, color: "var(--text-ghost)" }}>{category.available ? category.files.toLocaleString(language) : "-"}</td>
    </tr>
  );
}

export function BackupBlock({ backup }: { backup: BackupStatusWire | "unavailable" | null }) {
  const { t, rich, language } = useI18n();
  if (backup === null) return null;
  if (backup === "unavailable") {
    return (
      <>
        <SectionLabel>{t("logs.report.backups")}</SectionLabel>
        <p style={{ fontSize: 11, color: "var(--text-ghost)", margin: 0 }}>{t("storage.backup.unavailable")}</p>
      </>
    );
  }

  const failed = backup.lastRunAt !== null && !backup.ok;
  const status =
    backup.lastRunAt === null
      ? t("storage.backup.never")
      : backup.ok
        ? t("storage.backup.success", { age: formatAge(backup.lastRunAt, language) })
        : backup.error
          ? t("storage.backup.failedReason", { age: formatAge(backup.lastRunAt, language), reason: backup.error })
          : t("storage.backup.failed", { age: formatAge(backup.lastRunAt, language) });
  return (
    <>
      <SectionLabel>{t("logs.report.backups")}</SectionLabel>
      <p style={{ fontSize: 11, color: failed ? "#ff6b6b" : "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
        {status}{" "}
        <span style={{ color: "var(--text-ghost)" }}>
          {rich("storage.backup.keeping", {
            total: backup.retention.toLocaleString(language),
            directory: backup.destDir,
            path: (text) => <code style={{ fontFamily: "'JetBrains Mono',monospace" }}>{text}</code>,
          })}
        </span>
      </p>
    </>
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
  const { t, tn, rich, language } = useI18n();
  const count = plan.candidates.length;
  const targetWord = t(TARGET_LABELS[plan.target]);
  return (
    <div style={planBox}>
      <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: count > 0 ? "var(--text-primary)" : "var(--text-dim)" }}>
        {count > 0 ? t("storage.plan.summary", { total: count.toLocaleString(language), target: targetWord, size: formatSize(plan.bytes, language) }) : t("storage.plan.empty", { target: targetWord })}
      </p>
      <p style={{ margin: "4px 0 0", fontSize: 10, color: "var(--text-ghost)" }}>{t("storage.plan.notDeleted")}</p>

      {plan.skipped.length > 0 && (
        <ul style={{ margin: "8px 0 0", paddingLeft: 16, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.6 }}>
          {plan.skipped.map((skip) => (
            <li key={skip.reason}>{t("storage.plan.kept", { total: skip.count.toLocaleString(language), size: formatSize(skip.bytes, language), reason: t(SKIP_LABELS[skip.reason]) })}</li>
          ))}
        </ul>
      )}

      {plan.candidates.slice(0, SAMPLE_ROWS).map((candidate) => (
        <div key={candidate.path} style={sampleRow}>
          {tn("storage.plan.sample", candidate.ageDays, { path: candidate.path, size: formatSize(candidate.bytes, language), days: candidate.ageDays.toLocaleString(language) })}
        </div>
      ))}
      {count > SAMPLE_ROWS && <div style={sampleRow}>{t("storage.plan.more", { total: (count - SAMPLE_ROWS).toLocaleString(language) })}</div>}

      {count > 0 && phase.kind === "previewed" && (
        <button onClick={onAskConfirm} style={dangerBtn}>
          {t("storage.plan.askDelete", { total: count.toLocaleString(language), target: targetWord })}
        </button>
      )}

      {(phase.kind === "confirming" || phase.kind === "applying") && (
        <div style={{ marginTop: 12 }}>
          <p style={{ margin: 0, fontSize: 11, lineHeight: 1.5, color: "var(--text-secondary)" }}>
            {rich("storage.plan.warning", { strong: (text) => <strong style={{ color: "#ff6b6b" }}>{text}</strong> })}
          </p>
          <input
            value={confirmText}
            onChange={(event) => onConfirmText(event.target.value)}
            aria-label={t("storage.plan.confirm")}
            placeholder={t("storage.plan.confirm")}
            autoFocus
            style={{ ...dialogInput, marginTop: 8 }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button onClick={onCancelConfirm} style={{ ...dialogCancelBtn, flex: 1 }} disabled={phase.kind === "applying"}>
              {t("common.cancel")}
            </button>
            <button
              onClick={onApply}
              disabled={confirmText !== "DELETE" || phase.kind === "applying"}
              style={{ ...dangerBtn, marginTop: 0, flex: 1, opacity: confirmText === "DELETE" ? 1 : 0.5, cursor: confirmText === "DELETE" ? "pointer" : "not-allowed" }}
            >
              {phase.kind === "applying" ? t("storage.deleting") : t("storage.plan.delete")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ResultBlock({ result }: { result: PruneApplyWire }) {
  const { t, language } = useI18n();
  return (
    <div style={planBox}>
      {result.aborted ? (
        <p style={{ margin: 0, fontSize: 12, color: "#ff6b6b" }}>{t("storage.result.aborted", { reason: result.aborted })}</p>
      ) : (
        <p style={{ margin: 0, fontSize: 12, color: "var(--text-primary)" }}>
          {t("storage.result.deleted", { total: result.deleted.toLocaleString(language), size: formatSize(result.bytes, language) })}
        </p>
      )}
      {result.refused.length > 0 && (
        <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--text-dim)" }}>{t("storage.result.refused", { total: result.refused.length.toLocaleString(language) })}</p>
      )}
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
  return (
    <p role="alert" style={{ fontSize: 11, color: "#ff6b6b", margin: "8px 0 0", lineHeight: 1.5 }}>
      {children}
    </p>
  );
}

function formatAge(timestamp: number, language: string): string {
  const minutes = Math.floor(Math.max(0, Date.now() - timestamp) / 60000);
  const relative = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  if (minutes < 1) return relative.format(0, "second");
  if (minutes < 60) return relative.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return relative.format(-hours, "hour");
  return relative.format(-Math.floor(hours / 24), "day");
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
