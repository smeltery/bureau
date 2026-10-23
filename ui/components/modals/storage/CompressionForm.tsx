import { useRef, useState } from "react";
import type { StorageCompressionWire } from "../../../../shared/storage-types.ts";
import { formatSize } from "../../../../shared/format/human.ts";
import { dialogCancelBtn, dialogInput } from "../dialog-styles.ts";

export function CompressionForm({ onApplied }: { onApplied: () => void }) {
  const [days, setDays] = useState("30");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<StorageCompressionWire | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const valid = Number.isSafeInteger(Number(days)) && Number(days) >= 1 && Number(days) <= 36500;
  async function run(apply: boolean) {
    if (busy || !valid) return;
    const ticket = ++sequence.current;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/storage/compress", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ olderThanDays: Number(days), apply }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not compress transcripts.");
      if (ticket !== sequence.current) return;
      setResult(body);
      if (apply) onApplied();
    } catch (error) {
      if (ticket === sequence.current) setError(error instanceof Error ? error.message : "Compression failed.");
    } finally {
      if (ticket === sequence.current) setBusy(false);
    }
  }
  return (
    <section style={{ marginTop: 20, display: "grid", gap: 8, fontSize: 12 }}>
      <h4 style={{ margin: 0 }}>Compress old transcripts</h4>
      <p style={{ margin: 0, color: "var(--text-muted)" }}>
        Save disk space without deleting conversation history. Compressed sessions remain readable and can be resumed. Active sessions are skipped.
      </p>
      <label>
        Older than (days)
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
          {busy ? "Working…" : "Preview compression"}
        </button>
        {result && !result.applied && result.plan.candidates.length > 0 && (
          <button type="button" disabled={busy} style={dialogCancelBtn} onClick={() => void run(true)}>
            Compress eligible transcripts
          </button>
        )}
      </div>
      {error && (
        <p role="alert" style={{ margin: 0, color: "var(--red)" }}>
          {error}
        </p>
      )}
      {result && (
        <p role="status" style={{ margin: 0 }}>
          {result.applied
            ? `Compressed ${result.applied.compressed} transcripts; saved ${formatSize(result.applied.bytesBefore - result.applied.bytesAfter)}. ${result.applied.refused.length} skipped during application.`
            : `${result.plan.candidates.length} eligible transcripts (${formatSize(result.plan.bytes)} before compression). ${result.plan.skipped.reduce((total, row) => total + row.count, 0)} active or recent transcripts skipped. Eligibility is checked again when you apply.`}
        </p>
      )}
    </section>
  );
}
