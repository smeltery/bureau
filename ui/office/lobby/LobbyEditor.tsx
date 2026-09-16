// Dev art tool for lobby prop placement. Mounted when URL has ?lobbyEdit=1.
// Client-only: drag props, export a TypeScript snippet for layouts.ts, copy to clipboard.
import { useCallback, useEffect, useRef, useState } from "react";
import { Character } from "../scene/Character.tsx";
import { SCENE_W, SCENE_H } from "../grid.ts";
import { COL, ROW } from "./geometry.ts";
import { LOBBY_LAYOUTS, LOBBY_LAYOUT_IDS, type LobbyLayoutId, type Placement } from "./layouts.ts";
import { LobbyScene, type LobbyRoomRef } from "./LobbyScene.tsx";
import { LOBBY_PROPS, type PropStar } from "./props.tsx";
import { THEMES } from "../../themes/index.ts";
import { LobbyEditorPanel } from "./LobbyEditorPanel.tsx";
import { anchorPx, type EditorItem } from "./lobby-editor-util.ts";

const RECEP_OUTFIT = {
  color: "#c96a4b",
  hair: "#3b2a1e",
  hairStyle: "short" as const,
  skin: "#f1c9a5",
  beard: "none" as const,
  accessory: null,
  hat: "none" as const,
};

export function LobbyEditor({
  initialLayout,
  themeId,
  rooms,
  officeName,
  star,
}: {
  initialLayout: LobbyLayoutId;
  themeId: string;
  rooms: LobbyRoomRef[];
  officeName: string | null;
  star: PropStar | null;
}) {
  const [layout, setLayout] = useState<LobbyLayoutId>(initialLayout);
  const [theme, setTheme] = useState(() => THEMES.find((t) => t.id === themeId) ?? THEMES[0]);
  const mode = theme.mode;
  const [items, setItems] = useState<EditorItem[]>(() => LOBBY_LAYOUTS[initialLayout].placements.map((p, i) => ({ ...p, key: i })));
  const [recep, setRecep] = useState(LOBBY_LAYOUTS[initialLayout].receptionist);
  const [selected, setSelected] = useState<number | null>(null);
  const [addFamily, setAddFamily] = useState(LOBBY_PROPS[0].id);
  const [addVariant, setAddVariant] = useState(LOBBY_PROPS[0].variants[0].id);
  const [status, setStatus] = useState("");
  const [draft, setDraft] = useState<string | null>(null);
  const nextKey = useRef(1000);
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());

  useEffect(() => {
    if (selected === null) return;
    rowRefs.current.get(selected)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme.id);
    document.documentElement.setAttribute("data-theme-mode", theme.mode);
  }, [theme]);

  function loadLayout(id: LobbyLayoutId) {
    setLayout(id);
    setItems(LOBBY_LAYOUTS[id].placements.map((p, i) => ({ ...p, key: i })));
    setRecep(LOBBY_LAYOUTS[id].receptionist);
    setSelected(null);
    setDraft(null);
  }

  const update = useCallback((key: number, patch: Partial<Placement>) => {
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }, []);

  function startDrag(e: React.PointerEvent, target: { kind: "item"; key: number } | { kind: "recep" }) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const item = target.kind === "item" ? items.find((it) => it.key === target.key) : null;
    const start = target.kind === "item" ? { a: item!.a, b: item!.b, h: item!.h ?? 60 } : { a: recep.a, b: recep.b, h: 0 };
    if (target.kind === "item") setSelected(target.key);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (target.kind === "recep") {
        setRecep({ a: start.a + (dx / COL.dx + dy / COL.dy) / 2, b: start.b + (dy / ROW.dy - dx / COL.dx) / 2 });
        return;
      }
      const wall = item!.wall;
      if (wall === "right") update(target.key, { a: start.a + dx / COL.dx, h: start.h - (dy - dx * 0.5) });
      else if (wall === "left") update(target.key, { b: start.b - dx / COL.dx, h: start.h - (dy + dx * 0.5) });
      else update(target.key, { a: start.a + (dx / COL.dx + dy / COL.dy) / 2, b: start.b + (dy / ROW.dy - dx / COL.dx) / 2 });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (selected === null) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const step = e.shiftKey ? 0.5 : 0.1;
      const it = items.find((x) => x.key === selected);
      if (!it) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        setItems((l) => l.filter((x) => x.key !== selected));
        setSelected(null);
      } else if (e.key === "ArrowLeft") update(selected, it.wall === "right" ? { a: it.a - step } : it.wall === "left" ? { b: it.b + step } : { a: it.a - step });
      else if (e.key === "ArrowRight") update(selected, it.wall === "right" ? { a: it.a + step } : it.wall === "left" ? { b: it.b - step } : { a: it.a + step });
      else if (e.key === "ArrowUp") update(selected, it.wall ? { h: (it.h ?? 60) + step * 10 } : { b: it.b - step });
      else if (e.key === "ArrowDown") update(selected, it.wall ? { h: (it.h ?? 60) - step * 10 } : { b: it.b + step });
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, items, update]);

  function add() {
    const fam = LOBBY_PROPS.find((f) => f.id === addFamily)!;
    const v = fam.variants.find((x) => x.id === addVariant) ?? fam.variants[0];
    const key = nextKey.current++;
    const p: EditorItem = v.wall ? { key, family: fam.id, variant: v.id, a: 5, b: 0, wall: "right", h: 80 } : { key, family: fam.id, variant: v.id, a: 5, b: 5 };
    setItems((l) => [...l, p]);
    setSelected(key);
  }

  function applyText() {
    if (draft === null) return;
    try {
      const j = JSON.parse(draft) as { layout?: LobbyLayoutId; placements?: Placement[]; receptionist?: { a: number; b: number } };
      const list = Array.isArray(j) ? (j as Placement[]) : j.placements;
      if (!Array.isArray(list)) {
        setStatus("that JSON has no placements array");
        return;
      }
      if (j.layout && j.layout in LOBBY_LAYOUTS) setLayout(j.layout);
      setItems(list.map((p, i) => ({ ...p, key: i })));
      if (j.receptionist) setRecep(j.receptionist);
      setSelected(null);
      setDraft(null);
      setStatus(`loaded ${list.length} props`);
    } catch (err) {
      setStatus(`not valid JSON: ${String(err)}`);
    }
  }

  const recepPx = anchorPx({ family: "", variant: "", a: recep.a, b: recep.b });

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", userSelect: "none" }}>
      <div style={{ width: SCENE_W, height: SCENE_H, position: "relative", margin: "130px 0 40px 0", flex: "none" }} onPointerDown={() => setSelected(null)}>
        <LobbyScene
          rooms={rooms}
          officeName={officeName}
          mode={mode}
          layout={layout}
          star={star}
          placements={items}
          receptionistAt={recep}
          rightDoor={{ label: rooms[0]?.name ?? "Room 1", onClick: () => {} }}
          receptionist={
            <g transform="translate(-26 -68)">
              <Character state="idle" outfit={RECEP_OUTFIT} />
            </g>
          }
        />
        {items.map((it) => {
          const px = anchorPx(it);
          const sel = it.key === selected;
          return (
            <div
              key={it.key}
              onPointerDown={(e) => startDrag(e, { kind: "item", key: it.key })}
              title={`${it.family}:${it.variant}`}
              style={{
                position: "absolute",
                left: px.left - 7,
                top: px.top - 7,
                width: 14,
                height: 14,
                borderRadius: "50%",
                background: sel ? "#ff4d4d" : it.wall ? "#4da3ff" : "#ffd23f",
                border: "2px solid #222",
                cursor: "grab",
                zIndex: 10,
              }}
            />
          );
        })}
        <div
          onPointerDown={(e) => startDrag(e, { kind: "recep" })}
          title="receptionist"
          style={{
            position: "absolute",
            left: recepPx.left - 7,
            top: recepPx.top - 7,
            width: 14,
            height: 14,
            borderRadius: 3,
            background: "#7bc47f",
            border: "2px solid #222",
            cursor: "grab",
            zIndex: 10,
          }}
        />
      </div>
      <LobbyEditorPanel
        items={items}
        recep={recep}
        selected={selected}
        addFamily={addFamily}
        addVariant={addVariant}
        status={status}
        draft={draft}
        layoutSelect={
          <select value={layout} onChange={(e) => loadLayout(e.target.value as LobbyLayoutId)}>
            {LOBBY_LAYOUT_IDS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        }
        onLoadLayout={
          <select value={theme.id} onChange={(e) => setTheme(THEMES.find((t) => t.id === e.target.value) ?? THEMES[0])}>
            {THEMES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.displayName}
              </option>
            ))}
          </select>
        }
        onSelect={setSelected}
        onUpdate={update}
        onRemove={(key) => setItems((l) => l.filter((x) => x.key !== key))}
        onAddFamily={setAddFamily}
        onAddVariant={setAddVariant}
        onAdd={add}
        onReset={() => loadLayout(layout)}
        onDraft={(text) => {
          setDraft(text);
          if (text === null) setStatus("copied");
        }}
        onApplyDraft={applyText}
        onClearDraft={() => setDraft(null)}
        rowRefs={rowRefs}
      />
    </div>
  );
}
