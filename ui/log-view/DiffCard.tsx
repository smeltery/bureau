import { useCallback, useMemo, useState } from "react";
import type { DiffPayload } from "../../shared/types.ts";
import type { DiffOutputFormat } from "./DiffRenderer.tsx";
import { DiffFileRow } from "./DiffFileRow.tsx";
import { DiffOverlay } from "./DiffOverlay.tsx";
import { splitPatchByFile } from "./diff-patch.ts";

const PREF_KEY = "bureau:diff:outputFormat";
const INLINE_LINES_THRESHOLD = 200;

function readPref(): DiffOutputFormat {
  if (typeof localStorage === "undefined") return "line-by-line";
  const v = localStorage.getItem(PREF_KEY);
  return v === "side-by-side" ? "side-by-side" : "line-by-line";
}

function writePref(v: DiffOutputFormat) {
  try {
    localStorage.setItem(PREF_KEY, v);
  } catch {
    /* quota / private mode */
  }
}

export function DiffCard({ payload }: { payload: DiffPayload }) {
  const [outputFormat, setOutputFormat] = useState<DiffOutputFormat>(() => readPref());
  const setFormat = useCallback((v: DiffOutputFormat) => {
    setOutputFormat(v);
    writePref(v);
  }, []);

  const perFilePatch = useMemo(() => splitPatchByFile(payload.patchText ?? ""), [payload.patchText]);

  const inlineLineTotal = useMemo(() => payload.files.filter((f) => f.inlineEligible).reduce((sum, f) => sum + f.lineCount, 0), [payload.files]);
  const defaultExpanded = inlineLineTotal < INLINE_LINES_THRESHOLD;

  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const seed: Record<string, boolean> = {};
    for (const f of payload.files) if (f.inlineEligible) seed[f.path] = defaultExpanded;
    return seed;
  });

  const allExpanded = useMemo(() => payload.files.filter((f) => f.inlineEligible).every((f) => expanded[f.path]), [payload.files, expanded]);

  const toggleAll = useCallback(() => {
    const target = !allExpanded;
    const next: Record<string, boolean> = {};
    for (const f of payload.files) if (f.inlineEligible) next[f.path] = target;
    setExpanded(next);
  }, [payload.files, allExpanded]);

  const toggleFile = useCallback((path: string) => {
    setExpanded((prev) => ({ ...prev, [path]: !prev[path] }));
  }, []);

  const [overlayPath, setOverlayPath] = useState<string | null>(null);
  const overlaySummary = overlayPath ? (payload.files.find((f) => f.path === overlayPath) ?? null) : null;

  const headerLine = `+${payload.stats.additions} -${payload.stats.deletions} across ${payload.stats.filesChanged} file${payload.stats.filesChanged === 1 ? "" : "s"}`;

  return (
    <div
      style={{
        margin: "8px 0",
        borderRadius: 10,
        background: "var(--bg-subtle)",
        border: "1px solid var(--border)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          background: "var(--bg-overlay-solid)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <span
          style={{
            fontFamily: "'JetBrains Mono',monospace",
            fontSize: 12,
            color: "var(--text-secondary)",
            fontWeight: 600,
          }}
        >
          {headerLine}
        </span>
        {(payload.branch || payload.head || payload.subject) && (
          <span
            style={{
              fontFamily: "'JetBrains Mono',monospace",
              fontSize: 11,
              color: "var(--text-muted)",
            }}
          >
            {payload.subject ? (payload.head ? `${payload.subject} · ${payload.head}` : payload.subject) : payload.branch ? `${payload.branch} · ${payload.head ?? "—"}` : payload.head}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ display: "inline-flex", border: "1px solid var(--border-medium)", borderRadius: 6, overflow: "hidden" }}>
          {(["line-by-line", "side-by-side"] as const).map((fmt) => {
            const active = outputFormat === fmt;
            return (
              <button
                key={fmt}
                onClick={() => setFormat(fmt)}
                style={{
                  padding: "3px 10px",
                  border: "none",
                  cursor: "pointer",
                  background: active ? "var(--accent-bg)" : "transparent",
                  color: active ? "var(--accent)" : "var(--text-muted)",
                  fontSize: 11,
                  fontFamily: "'DM Sans',sans-serif",
                  fontWeight: 600,
                }}
              >
                {fmt === "line-by-line" ? "Unified" : "Split"}
              </button>
            );
          })}
        </span>
        {payload.files.some((f) => f.inlineEligible) && (
          <button
            onClick={toggleAll}
            style={{
              padding: "3px 10px",
              border: "1px solid var(--border-medium)",
              background: "transparent",
              color: "var(--text-dim)",
              borderRadius: 6,
              fontSize: 11,
              fontFamily: "'DM Sans',sans-serif",
              cursor: "pointer",
            }}
          >
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
        )}
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "var(--text-faint)", flexBasis: "100%", marginTop: -2 }}>
          {payload.cwd}
          {payload.truncated && <span style={{ color: "var(--orange)", marginLeft: 8 }}>· patch &gt; 2 MB · summary only</span>}
        </span>
      </div>
      <div>
        {payload.files.map((f) => (
          <DiffFileRow
            key={f.path}
            summary={f}
            patch={perFilePatch.get(f.path) ?? null}
            outputFormat={outputFormat}
            expanded={!!expanded[f.path]}
            onToggle={() => toggleFile(f.path)}
            onOverlay={() => setOverlayPath(f.path)}
            truncated={payload.truncated}
          />
        ))}
      </div>
      {overlaySummary && (
        <DiffOverlay summary={overlaySummary} patch={perFilePatch.get(overlaySummary.path) ?? null} outputFormat={outputFormat} truncated={payload.truncated} onClose={() => setOverlayPath(null)} />
      )}
    </div>
  );
}
