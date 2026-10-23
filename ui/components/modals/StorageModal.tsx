import { CompressionForm } from "./storage/CompressionForm.tsx";
import { BackupSettingsForm } from "./storage/BackupSettingsForm.tsx";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PrunePlanWire, PruneTarget, StoragePruneWire, StorageUsageWire } from "../../../shared/storage-types.ts";
import { applyRequest, planMatchesForm, previewRequest, type PolicyForm } from "../../storage-prune-form.ts";
import { dialogCancelBtn, dialogInput } from "./dialog-styles.ts";
import { Modal } from "./Modal.tsx";
import { BackupBlock, ErrorLine, FieldLabel, PlanBlock, ResultBlock, SectionLabel, UsageBlock, type BackupStatusWire, type StoragePhase } from "./StorageModalParts.tsx";
import { useI18n } from "../../i18n.tsx";
import { storageRequest, storageFailure, type StorageFailure } from "./storage/request.ts";

const TARGET_LABELS = {
  transcripts: "storage.target.transcripts",
  attachments: "storage.target.attachments",
  "token-logs": "storage.target.tokenLogs",
  "terminal-recordings": "storage.target.recordings",
} as const;

export function StorageModal({ onBack, embedded = false, onDeletingChange }: { onBack?: () => void; embedded?: boolean; onDeletingChange?: (deleting: boolean) => void }) {
  const { t, rich } = useI18n();
  const [usage, setUsage] = useState<StorageUsageWire | null>(null);
  const [backup, setBackup] = useState<BackupStatusWire | "unavailable" | null>(null);
  const [loadError, setLoadError] = useState<StorageFailure | null>(null);
  const [target, setTarget] = useState<PruneTarget>("transcripts");
  const [olderThanDays, setOlderThanDays] = useState("90");
  const [keepPerAgent, setKeepPerAgent] = useState("5");
  const [phase, setPhase] = useState<StoragePhase>({ kind: "idle" });
  const [confirmText, setConfirmText] = useState("");
  const [pruneError, setPruneError] = useState<StorageFailure | null>(null);
  const requestTicket = useRef(0);

  const loadUsage = useCallback(() => {
    setLoadError(null);
    storageRequest<StorageUsageWire>("/api/storage/usage", "storage.measureFailed")
      .then(setUsage)
      .catch((error: unknown) => setLoadError(storageFailure(error, "storage.measureFailed")));
  }, []);

  useEffect(() => {
    loadUsage();
    storageRequest<BackupStatusWire>("/api/backup/status", "storage.backup.unavailable")
      .then(setBackup)
      .catch(() => setBackup("unavailable"));
  }, [loadUsage]);

  function editForm(apply: () => void) {
    requestTicket.current++;
    apply();
    setPhase({ kind: "idle" });
    setConfirmText("");
    setPruneError(null);
  }

  const form: PolicyForm = { target, olderThanDays, keepPerAgent };
  const formValid = previewRequest(form) !== null;
  const busy = phase.kind === "previewing" || phase.kind === "applying";
  const deleting = phase.kind === "applying";
  const plan = phase.kind === "previewed" || phase.kind === "confirming" || phase.kind === "applying" ? phase.plan : null;

  useEffect(() => {
    onDeletingChange?.(deleting);
    return () => onDeletingChange?.(false);
  }, [deleting, onDeletingChange]);

  async function runPreview() {
    const body = previewRequest(form);
    if (!body) return;
    const ticket = ++requestTicket.current;
    setPruneError(null);
    setPhase({ kind: "previewing" });
    try {
      const result = await storageRequest<StoragePruneWire>("/api/storage/prune", "storage.pruneFailed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (ticket !== requestTicket.current || !planMatchesForm(result.plan, form)) return;
      setPhase({ kind: "previewed", plan: result.plan });
    } catch (error) {
      if (ticket !== requestTicket.current) return;
      setPhase({ kind: "idle" });
      setPruneError(storageFailure(error, "storage.pruneFailed"));
    }
  }

  async function runApply(appliedPlan: PrunePlanWire) {
    const ticket = ++requestTicket.current;
    setPruneError(null);
    setPhase({ kind: "applying", plan: appliedPlan });
    try {
      const result = await storageRequest<StoragePruneWire>("/api/storage/prune", "storage.deleteFailed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(applyRequest(appliedPlan)),
      });
      if (ticket !== requestTicket.current) return;
      if (!result.applied) {
        setPhase({ kind: "idle" });
        setPruneError({ key: "storage.deleteNotRun" });
        return;
      }
      setPhase({ kind: "done", result: result.applied });
      setConfirmText("");
      loadUsage();
    } catch (error) {
      if (ticket !== requestTicket.current) return;
      setPhase({ kind: "idle" });
      setPruneError(storageFailure(error, "storage.deleteFailed"));
    }
  }

  const body = (
    <>
      <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>{t("storage.title")}</h3>
      <UsageBlock usage={usage} error={loadError === null ? null : typeof loadError === "string" ? loadError : t(loadError.key)} />
      <BackupBlock backup={backup} />
      <BackupSettingsForm
        onSaved={() => {
          loadUsage();
          storageRequest<BackupStatusWire>("/api/backup/status", "storage.backup.unavailable")
            .then(setBackup)
            .catch(() => setBackup("unavailable"));
        }}
      />

      <CompressionForm onApplied={loadUsage} />
      <SectionLabel>{t("storage.deleteTitle")}</SectionLabel>
      <div style={warningBox}>{rich("storage.deleteWarning", { strong: (text) => <strong style={{ color: "#ff6b6b" }}>{text}</strong> })}</div>

      <FieldLabel>{t("storage.targetLabel")}</FieldLabel>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {(Object.keys(TARGET_LABELS) as PruneTarget[]).map((item) => (
          <button key={item} onClick={() => editForm(() => setTarget(item))} disabled={busy} style={toggleStyle(target === item, busy)}>
            {t(TARGET_LABELS[item])}
          </button>
        ))}
      </div>

      {(target === "token-logs" || target === "terminal-recordings") && <p style={hint}>{t("storage.wholeFilesHint")}</p>}
      <FieldLabel>{t("storage.olderThan")}</FieldLabel>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="number"
          min={1}
          max={36500}
          aria-label={t("storage.olderThan")}
          value={olderThanDays}
          disabled={busy}
          onChange={(event) => editForm(() => setOlderThanDays(event.target.value))}
          style={{ ...dialogInput, width: 90, opacity: busy ? 0.5 : 1 }}
        />
        <span style={hint}>{t("storage.daysHint")}</span>
      </div>

      {target === "transcripts" && (
        <>
          <FieldLabel>{t("storage.keepPerAgent")}</FieldLabel>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="number"
              min={0}
              aria-label={t("storage.keepPerAgent")}
              value={keepPerAgent}
              disabled={busy}
              onChange={(event) => editForm(() => setKeepPerAgent(event.target.value))}
              style={{ ...dialogInput, width: 90, opacity: busy ? 0.5 : 1 }}
            />
            <span style={hint}>{t("storage.keepHint")}</span>
          </div>
        </>
      )}

      <button
        onClick={() => void runPreview()}
        disabled={!formValid || busy}
        style={{ ...dialogCancelBtn, marginTop: 14, width: "100%", opacity: formValid && !busy ? 1 : 0.5, cursor: formValid && !busy ? "pointer" : "not-allowed" }}
      >
        {phase.kind === "previewing" ? t("storage.checking") : t("storage.preview")}
      </button>

      {pruneError && <ErrorLine>{typeof pruneError === "string" ? pruneError : t(pruneError.key)}</ErrorLine>}
      {plan && (
        <PlanBlock
          plan={plan}
          phase={phase}
          confirmText={confirmText}
          onConfirmText={setConfirmText}
          onAskConfirm={() => setPhase({ kind: "confirming", plan })}
          onCancelConfirm={() => setPhase({ kind: "previewed", plan })}
          onApply={() => void runApply(plan)}
        />
      )}
      {phase.kind === "done" && <ResultBlock result={phase.result} />}

      {!embedded && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
          <button onClick={onBack} disabled={deleting} style={{ ...dialogCancelBtn, opacity: deleting ? 0.5 : 1, cursor: deleting ? "not-allowed" : "pointer" }}>
            {deleting ? t("storage.deleting") : t("storage.back")}
          </button>
        </div>
      )}
    </>
  );

  if (embedded) return <div style={{ marginTop: 8 }}>{body}</div>;

  return (
    <Modal onClose={() => !deleting && onBack?.()} width={560} allowBackdropClose={!deleting}>
      {body}
    </Modal>
  );
}

function toggleStyle(active: boolean, disabled: boolean): React.CSSProperties {
  return {
    ...dialogCancelBtn,
    flex: 1,
    borderColor: active ? "var(--accent)" : "var(--border)",
    color: active ? "var(--text-primary)" : "var(--text-dim)",
    background: active ? "var(--bg-input)" : "transparent",
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}

const hint: React.CSSProperties = { fontSize: 11, color: "var(--text-ghost)" };
const warningBox: React.CSSProperties = {
  border: "1px solid rgba(255,107,107,0.45)",
  background: "rgba(255,107,107,0.08)",
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 11,
  lineHeight: 1.5,
  color: "var(--text-secondary)",
};
