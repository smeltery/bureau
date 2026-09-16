// Side panel for the lobby layout editor: prop list, add/remove, export.
import { type CSSProperties } from "react";
import { LOBBY_PROPS, variantFacings } from "./props.tsx";
import type { Placement } from "./layouts.ts";
import { exportLayoutTs, placementsJson, roundCoord, type EditorItem } from "./lobby-editor-util.ts";

const panelStyle: CSSProperties = {
  width: 360,
  fontFamily: "DM Sans, sans-serif",
  fontSize: 12,
  color: "var(--text-primary)",
  padding: 12,
  overflowY: "auto",
  maxHeight: "100%",
  flex: "none",
};
const inputStyle: CSSProperties = { width: 52, fontSize: 11 };

export function LobbyEditorPanel({
  items,
  recep,
  selected,
  addFamily,
  addVariant,
  status,
  draft,
  layoutSelect,
  onSelect,
  onUpdate,
  onRemove,
  onAddFamily,
  onAddVariant,
  onAdd,
  onReset,
  onLoadLayout,
  onDraft,
  onApplyDraft,
  onClearDraft,
  rowRefs,
}: {
  items: EditorItem[];
  recep: { a: number; b: number };
  selected: number | null;
  addFamily: string;
  addVariant: string;
  status: string;
  draft: string | null;
  layoutSelect: React.ReactNode;
  onSelect: (key: number | null) => void;
  onUpdate: (key: number, patch: Partial<Placement>) => void;
  onRemove: (key: number) => void;
  onAddFamily: (id: string) => void;
  onAddVariant: (id: string) => void;
  onAdd: () => void;
  onReset: () => void;
  onLoadLayout: React.ReactNode;
  onDraft: (text: string | null) => void;
  onApplyDraft: () => void;
  onClearDraft: () => void;
  rowRefs: React.MutableRefObject<Map<number, HTMLTableRowElement>>;
}) {
  const exportedTs = exportLayoutTs(items, recep);
  const exportedJson = placementsJson(items, recep);
  const boxText = draft ?? exportedJson;

  async function copyTs() {
    try {
      await navigator.clipboard.writeText(exportedTs);
      onDraft(null);
    } catch {
      onDraft(exportedTs);
    }
  }

  return (
    <div style={panelStyle}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
        {layoutSelect}
        <button type="button" onClick={onReset}>
          reset
        </button>
        {onLoadLayout}
      </div>
      <div style={{ color: "var(--text-dim)", marginBottom: 8 }}>
        Drag the dots. Arrows nudge (shift: bigger), Delete removes. Yellow: floor, blue: wall, green: receptionist. Copy TS for layouts.ts.
      </div>
      <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 8 }}>
        <select
          value={addFamily}
          onChange={(e) => {
            onAddFamily(e.target.value);
            onAddVariant(LOBBY_PROPS.find((f) => f.id === e.target.value)!.variants[0].id);
          }}
        >
          {LOBBY_PROPS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <select value={addVariant} onChange={(e) => onAddVariant(e.target.value)}>
          {LOBBY_PROPS.find((f) => f.id === addFamily)!.variants.map((v) => (
            <option key={v.id} value={v.id}>
              {v.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={onAdd}>
          add
        </button>
      </div>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <tbody>
          {items.map((it) => {
            const fam = LOBBY_PROPS.find((f) => f.id === it.family)!;
            const sel = it.key === selected;
            return (
              <tr
                key={it.key}
                ref={(el) => {
                  if (el) rowRefs.current.set(it.key, el);
                  else rowRefs.current.delete(it.key);
                }}
                onClick={() => onSelect(it.key)}
                style={{
                  background: sel ? "var(--accent)" : undefined,
                  color: sel ? "#fff" : undefined,
                  outline: sel ? "2px solid #ff4d4d" : undefined,
                  cursor: "pointer",
                }}
              >
                <td style={{ padding: 2 }}>
                  <select
                    value={it.family}
                    onChange={(e) => {
                      const f = LOBBY_PROPS.find((x) => x.id === e.target.value)!;
                      onUpdate(it.key, { family: f.id, variant: f.variants[0].id });
                    }}
                  >
                    {LOBBY_PROPS.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.id}
                      </option>
                    ))}
                  </select>
                  <select value={it.variant} onChange={(e) => onUpdate(it.key, { variant: e.target.value })}>
                    {fam.variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.id}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ padding: 2, whiteSpace: "nowrap" }}>
                  <select
                    value={it.wall ?? ""}
                    onChange={(e) =>
                      onUpdate(it.key, {
                        wall: (e.target.value || undefined) as Placement["wall"],
                        h: e.target.value ? (it.h ?? 80) : undefined,
                        a: e.target.value === "left" ? 0 : it.a,
                        b: e.target.value === "right" ? 0 : it.b,
                      })
                    }
                  >
                    <option value="">floor</option>
                    <option value="left">left</option>
                    <option value="right">right</option>
                  </select>
                  {it.wall && <input style={inputStyle} type="number" step="5" value={roundCoord(it.h ?? 60)} onChange={(e) => onUpdate(it.key, { h: Number(e.target.value) })} title="height" />}
                  <input style={inputStyle} type="number" step="0.05" value={it.scale ?? 1} onChange={(e) => onUpdate(it.key, { scale: Number(e.target.value) })} title="scale" />
                  {!it.wall && <input style={inputStyle} type="number" step="0.5" value={it.z ?? 0} onChange={(e) => onUpdate(it.key, { z: Number(e.target.value) })} title="draw order" />}
                  {it.wall ? (
                    <label title="flip">
                      <input type="checkbox" checked={!!it.flip} onChange={(e) => onUpdate(it.key, { flip: e.target.checked })} />f
                    </label>
                  ) : (
                    (() => {
                      const n = variantFacings(fam.variants.find((v) => v.id === it.variant) ?? fam.variants[0]);
                      if (n === 1) return null;
                      const options = n === 4 ? ["SE", "SW", "NE", "NW"] : ["SE", "SW"];
                      return (
                        <select value={it.facing ?? (it.flip ? "SW" : "SE")} onChange={(e) => onUpdate(it.key, { facing: e.target.value as Placement["facing"], flip: undefined })}>
                          {options.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      );
                    })()
                  )}
                  <button type="button" onClick={() => onRemove(it.key)}>
                    x
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ margin: "8px 0 4px", display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={() => void copyTs()}>
          Copy TS
        </button>
        <button type="button" onClick={onApplyDraft} disabled={draft === null}>
          apply JSON
        </button>
        <button type="button" onClick={onClearDraft} disabled={draft === null}>
          revert
        </button>
        <button type="button" onClick={() => onDraft(exportedTs)} title="show layouts.ts block">
          show as TS
        </button>
        <span style={{ color: "var(--text-dim)" }}>{status}</span>
      </div>
      <textarea value={boxText} onChange={(e) => onDraft(e.target.value)} spellCheck={false} style={{ width: "100%", height: 220, fontFamily: "JetBrains Mono, monospace", fontSize: 10 }} />
    </div>
  );
}
