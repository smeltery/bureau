import { useRef, useState } from "react";
import type { StorageCompressionWire } from "../../../../shared/storage-types.ts";
import { formatSize } from "../../../../shared/format/human.ts";
import { dialogCancelBtn, dialogInput } from "../dialog-styles.ts";
import { useI18n } from "../../../i18n.tsx";
import { storageRequest, storageFailure, type StorageFailure } from "./request.ts";

export function CompressionForm({ onApplied }: { onApplied: () => void }) {
  const { t, tn, language } = useI18n();
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<StorageCompressionWire | null>(null);
  const [error, setError] = useState<StorageFailure | null>(null);
  const sequence = useRef(0);
  const valid = Number.isSafeInteger(Number(days)) && Number(days) >= 1 && Number(days) <= 36500;
  async function run(apply: boolean) {
    if (busy || !valid) return;
    const ticket = ++sequence.current;
    setBusy(true);
    setError(null);
    try {
      const body = await storageRequest<StorageCompressionWire>("/api/storage/compress", "storage.compression.failed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ olderThanDays: Number(days), apply }),
      });
      if (ticket !== sequence.current) return;
      setResult(body);
      if (apply) onApplied();
    } catch (error) {
      if (ticket === sequence.current) setError(storageFailure(error, "storage.compression.failed"));
    } finally {
      if (ticket === sequence.current) setBusy(false);
    }
  }
  return (
    <section style={{ marginTop: 20, display: "grid", gap: 8, fontSize: 12 }}>
      <h4 style={{ margin: 0 }}>{t("storage.compression.title")}</h4>
      <p style={{ margin: 0, color: "var(--text-muted)" }}>{t("storage.compression.description")}</p>
      <label>
        {t("storage.compression.days")}
        <input
          type="number"
          min={1}
          max={36500}
          step={1}
          value={days}
          disabled={busy}
          style={dialogInput}
          onChange={(event) => {
            sequence.current++;
            setDays(event.target.value);
            setResult(null);
            setError(null);
          }}
        />
      </label>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" disabled={busy || !valid} style={dialogCancelBtn} onClick={() => void run(false)}>
          {busy ? t("storage.compression.working") : t("storage.compression.preview")}
        </button>
        {result && !result.applied && result.plan.candidates.length > 0 && (
          <button type="button" disabled={busy} style={dialogCancelBtn} onClick={() => void run(true)}>
            {t("storage.compression.apply")}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" style={{ margin: 0, color: "var(--red)" }}>
          {typeof error === "string" ? error : t(error.key)}
        </p>
      )}
      {result && (
        <p role="status" style={{ margin: 0 }}>
          {result.applied
            ? `${tn("storage.compression.applied", result.applied.compressed, { size: formatSize(result.applied.bytesBefore - result.applied.bytesAfter, language) })} ${tn("storage.compression.refused", result.applied.refused.length)}`
            : `${tn("storage.compression.eligible", result.plan.candidates.length, { size: formatSize(result.plan.bytes, language) })} ${tn(
                "storage.compression.skipped",
                result.plan.skipped.reduce((total, row) => total + row.count, 0),
              )}`}
        </p>
      )}
    </section>
  );
}
