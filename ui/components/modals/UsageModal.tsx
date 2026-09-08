import { useEffect, useState } from "react";
import type { UsageBucketWire, UsageReportWire } from "../../../shared/types.ts";
import { dialogCancelBtn } from "./dialog-styles.ts";
import { ErrorLine, SectionLabel } from "./StorageModalParts.tsx";
import { Modal } from "./Modal.tsx";

class ApiError extends Error {}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(path, { method: "GET", credentials: "same-origin" });
  if (!res.ok) {
    let message = `GET ${path} failed (${res.status})`;
    try {
      const parsed = (await res.json()) as { error?: unknown };
      if (typeof parsed.error === "string") message = parsed.error;
    } catch {}
    throw new ApiError(message);
  }
  return (await res.json()) as T;
}

export function UsageModal({ onBack, embedded = false }: { onBack?: () => void; embedded?: boolean }) {
  const [usage, setUsage] = useState<UsageReportWire | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<UsageReportWire>("/api/usage")
      .then(setUsage)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Could not load usage."));
  }, []);

  const body = (
    <>
      <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: "var(--text-primary)" }}>Office Usage</h3>
      <p style={hint}>Subscription plan limits are not shown here. This page reports token usage and estimated cost recorded by Bureau.</p>
      {usage?.scoped && <p style={hint}>Scoped to the rooms you can access. Schedule usage is not included.</p>}
      {error ? (
        <ErrorLine>{error}</ErrorLine>
      ) : !usage ? (
        <p style={{ fontSize: 11, color: "var(--text-ghost)", marginTop: 16 }}>Loading...</p>
      ) : (
        <>
          <UsageTable
            title="Agent usage"
            firstHeader="Agent"
            rows={usage.agents.map((row) => ({ key: row.id, label: row.name, detail: row.roomName, session: row.session, lifetime: row.lifetime }))}
          />
          <UsageTable
            title="Per-room usage"
            note="Killed agents contribute to the room they were last in."
            firstHeader="Room"
            rows={usage.rooms.map((row) => ({ key: row.id, label: row.name, detail: row.deleted ? "deleted" : undefined, session: row.session, lifetime: row.lifetime }))}
          />
          {usage.cronjobs && usage.cronjobs.length > 0 && (
            <LifetimeTable title="Per-cron job usage" rows={usage.cronjobs.map((row) => ({ key: row.id, label: row.name, detail: row.deleted ? "deleted" : undefined, lifetime: row.lifetime }))} />
          )}
          <UsageTable title={usage.scoped ? "Total" : "Office total"} firstHeader="" rows={[{ key: "total", label: "Total", session: usage.total.session, lifetime: usage.total.lifetime }]} />
        </>
      )}
      {!embedded && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
          <button onClick={onBack} style={dialogCancelBtn}>
            Back to settings
          </button>
        </div>
      )}
    </>
  );

  if (embedded) return <div style={{ marginTop: 8 }}>{body}</div>;

  return (
    <Modal onClose={() => onBack?.()} width={760}>
      {body}
    </Modal>
  );
}

type UsageRow = { key: string; label: string; detail?: string; session: UsageBucketWire; lifetime: UsageBucketWire };

function UsageTable({ title, note, firstHeader, rows }: { title: string; note?: string; firstHeader: string; rows: UsageRow[] }) {
  return (
    <section>
      <SectionLabel>{title}</SectionLabel>
      {note && <p style={hint}>{note}</p>}
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={leftHead}>{firstHeader}</th>
              <th style={head}>In (sess)</th>
              <th style={head}>Out (sess)</th>
              <th style={head}>$ (sess)</th>
              <th style={head}>In (life)</th>
              <th style={head}>Out (life)</th>
              <th style={head}>$ (life)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td style={leftCell}>
                  <strong>{row.label}</strong>
                  {row.detail && <span style={detail}> {row.detail}</span>}
                </td>
                <BucketCells bucket={row.session} />
                <BucketCells bucket={row.lifetime} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LifetimeTable({ title, rows }: { title: string; rows: Omit<UsageRow, "session">[] }) {
  return (
    <section>
      <SectionLabel>{title}</SectionLabel>
      <div style={{ overflowX: "auto" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={leftHead}>Schedule</th>
              <th style={head}>In (life)</th>
              <th style={head}>Out (life)</th>
              <th style={head}>$ (life)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td style={leftCell}>
                  <strong>{row.label}</strong>
                  {row.detail && <span style={detail}> {row.detail}</span>}
                </td>
                <BucketCells bucket={row.lifetime} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BucketCells({ bucket }: { bucket: UsageBucketWire }) {
  return (
    <>
      <td style={cellRight}>{inputCount(bucket)}</td>
      <td style={cellRight}>{tokenCount(bucket.totalOut)}</td>
      <td style={cellRight}>{dollars(bucket.costUSD)}</td>
    </>
  );
}

function tokenCount(n: number): string {
  if (n === 0) return "-";
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toLocaleString();
}

function inputCount(bucket: UsageBucketWire): string {
  if (bucket.totalIn === 0) return "-";
  const cacheable = bucket.cacheRead + bucket.cacheCreation;
  if (cacheable === 0) return tokenCount(bucket.totalIn);
  const hit = Math.round((bucket.cacheRead / cacheable) * 100);
  return hit < 80 ? `${tokenCount(bucket.totalIn)} (${hit}% hit)` : tokenCount(bucket.totalIn);
}

function dollars(n: number): string {
  if (n === 0) return "-";
  return n >= 100 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`;
}

const hint: React.CSSProperties = { fontSize: 11, color: "var(--text-ghost)", lineHeight: 1.5 };
const tableStyle: React.CSSProperties = { width: "100%", borderCollapse: "collapse", fontSize: 11 };
const head: React.CSSProperties = { padding: "4px 6px", textAlign: "right", color: "var(--text-muted)", borderBottom: "1px solid var(--border)" };
const leftHead: React.CSSProperties = { ...head, textAlign: "left" };
const cellRight: React.CSSProperties = {
  padding: "4px 6px",
  textAlign: "right",
  color: "var(--text-secondary)",
  borderBottom: "1px solid var(--border-subtle)",
  fontFamily: "'JetBrains Mono',monospace",
};
const leftCell: React.CSSProperties = { padding: "4px 6px", color: "var(--text-secondary)", borderBottom: "1px solid var(--border-subtle)", minWidth: 130 };
const detail: React.CSSProperties = { color: "var(--text-ghost)", fontWeight: 400 };
