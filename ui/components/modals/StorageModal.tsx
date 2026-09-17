import { useCallback, useEffect, useRef, useState } from "react";
import type { PrunePlanWire, PruneTarget, StoragePruneWire, StorageUsageWire } from "../../../shared/storage-types.ts";
import { applyRequest, planMatchesForm, previewRequest, type PolicyForm } from "../../storage-prune-form.ts";
import { dialogCancelBtn, dialogInput } from "./dialog-styles.ts";
import { Modal } from "./Modal.tsx";
import { BackupBlock, ErrorLine, FieldLabel, PlanBlock, ResultBlock, SectionLabel, UsageBlock, type BackupStatusWire, type StoragePhase } from "./StorageModalParts.tsx";
import { useI18n } from "../../i18n.tsx";

const TARGET_LABELS = {
  transcripts: "storage.target.transcripts",
  attachments: "storage.target.attachments",
} as const;

class ApiError extends Error {}

async function apiFetch<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let message = `${method} ${path} failed (${res.status})`;
    try {
      const parsed = (await res.json()) as { error?: unknown };
      if (typeof parsed.error === "string") message = parsed.error;
    } catch {}
    throw new ApiError(message);
  }
  return (await res.json()) as T;
}

export function StorageModal({ onBack, embedded = false, onDeletingChange }: { onBack?: () => void; embedded?: boolean; onDeletingChange?: (deleting: boolean) => void }) {
  const { t } = useI18n();
  const [usage, setUsage] = useState<StorageUsageWire | null>(null);
  const [backup, setBackup] = useState<BackupStatusWire | "unavailable" | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [target, setTarget] = useState<PruneTarget>("transcripts");
  const [olderThanDays, setOlderThanDays] = useState("90");
  const [keepPerAgent, setKeepPerAgent] = useState("5");
  const [phase, setPhase] = useState<StoragePhase>({ kind: "idle" });
  const [confirmText, setConfirmText] = useState("");
  const [pruneError, setPruneError] = useState<string | null>(null);
  const requestTicket = useRef(0);

  const loadUsage = useCallback(() => {
    setLoadError(null);
    apiFetch<StorageUsageWire>("GET", "/api/storage/usage")
      .then(setUsage)
      .catch((error: unknown) => setLoadError(error instanceof ApiError ? error.message : "Could not measure storage."));
  }, []);

  useEffect(() => {
    loadUsage();
    apiFetch<BackupStatusWire>("GET", "/api/backup/status")
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
      const result = await apiFetch<StoragePruneWire>("POST", "/api/storage/prune", body);
      if (ticket !== requestTicket.current || !planMatchesForm(result.plan, form)) return;
      setPhase({ kind: "previewed", plan: result.plan });
    } catch (error) {
      if (ticket !== requestTicket.current) return;
      setPhase({ kind: "idle" });
      setPruneError(error instanceof ApiError ? error.message : "The prune request failed.");
    }
  }

  async function runApply(appliedPlan: PrunePlanWire) {
    const ticket = ++requestTicket.current;
    setPruneError(null);
    setPhase({ kind: "applying", plan: appliedPlan });
    try {
      const result = await apiFetch<StoragePruneWire>("POST", "/api/storage/prune", applyRequest(appliedPlan));
      if (ticket !== requestTicket.current) return;
      if (!result.applied) {
        setPhase({ kind: "idle" });
        setPruneError("The delete did not run. Nothing was removed.");
        return;
      }
      setPhase({ kind: "done", result: result.applied });
      setConfirmText("");
      loadUsage();
    } catch (error) {
      if (ticket !== requestTicket.current) return;
      setPhase({ kind: "idle" });
      setPruneError(error instanceof ApiError ? error.message : "The delete request failed.");
    }
  }

  const body = (
    <>
      <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>{t("storage.title")}</h3>
      <UsageBlock usage={usage} error={loadError} />
      <BackupBlock backup={backup} />

      <SectionLabel>Delete old files</SectionLabel>
      <div style={warningBox}>
        <strong style={{ color: "#ff6b6b" }}>This permanently deletes files from this machine.</strong> Preview first, then type DELETE before Bureau removes anything.
      </div>

      <FieldLabel>What to delete</FieldLabel>
      <div style={{ display: "flex", gap: 8 }}>
        {(Object.keys(TARGET_LABELS) as PruneTarget[]).map((item) => (
          <button key={item} onClick={() => editForm(() => setTarget(item))} disabled={busy} style={toggleStyle(target === item, busy)}>
            {t(TARGET_LABELS[item])}
          </button>
        ))}
      </div>

      <FieldLabel>Older than</FieldLabel>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="number"
          min={1}
          value={olderThanDays}
          disabled={busy}
          onChange={(event) => editForm(() => setOlderThanDays(event.target.value))}
          style={{ ...dialogInput, width: 90, opacity: busy ? 0.5 : 1 }}
        />
        <span style={hint}>days. Anything newer is kept.</span>
      </div>

      {target === "transcripts" && (
        <>
          <FieldLabel>Always keep, per agent</FieldLabel>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="number"
              min={0}
              value={keepPerAgent}
              disabled={busy}
              onChange={(event) => editForm(() => setKeepPerAgent(event.target.value))}
              style={{ ...dialogInput, width: 90, opacity: busy ? 0.5 : 1 }}
            />
            <span style={hint}>newest conversations, even when older.</span>
          </div>
        </>
      )}

      <button
        onClick={() => void runPreview()}
        disabled={!formValid || busy}
        style={{ ...dialogCancelBtn, marginTop: 14, width: "100%", opacity: formValid && !busy ? 1 : 0.5, cursor: formValid && !busy ? "pointer" : "not-allowed" }}
      >
        {phase.kind === "previewing" ? "Checking..." : "Preview what would be deleted"}
      </button>

      {pruneError && <ErrorLine>{pruneError}</ErrorLine>}
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
            {deleting ? "Deleting..." : "Back to settings"}
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
