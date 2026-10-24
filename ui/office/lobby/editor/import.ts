import type { PlainMessageKey } from "../../../../shared/i18n/translate.ts";
import { LOBBY_LAYOUTS, type LobbyLayoutId, type Placement } from "../layouts.ts";
import { LOBBY_PROPS } from "../props.tsx";

type ImportedLayout = { placements: Placement[]; layout?: LobbyLayoutId; receptionist?: { a: number; b: number } };
export type ImportResult = { ok: true; value: ImportedLayout } | { ok: false; key: PlainMessageKey };
export type EditorStatus = { kind: "copied" } | { kind: "loaded"; count: number } | { kind: "error"; key: PlainMessageKey } | null;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function placement(value: unknown): value is Placement {
  if (!record(value) || !finite(value.a) || !finite(value.b)) return false;
  const family = LOBBY_PROPS.find((item) => item.id === value.family);
  if (!family?.variants.some((item) => item.id === value.variant)) return false;
  if (["h", "scale", "z"].some((key) => value[key] !== undefined && !finite(value[key]))) return false;
  if (value.wall !== undefined && value.wall !== "left" && value.wall !== "right") return false;
  if (value.flip !== undefined && typeof value.flip !== "boolean") return false;
  return value.facing === undefined || (typeof value.facing === "string" && ["SE", "SW", "NE", "NW"].includes(value.facing));
}

export function importLayout(text: string): ImportResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, key: "settingsUi.editorInvalid" };
  }
  const envelope = record(data) ? data : {};
  const list = Array.isArray(data) ? data : envelope.placements;
  if (!Array.isArray(list)) return { ok: false, key: "settingsUi.editorMissing" };
  if (!list.every(placement)) return { ok: false, key: "settingsUi.editorInvalidPlacement" };
  if (envelope.layout !== undefined && (typeof envelope.layout !== "string" || !Object.hasOwn(LOBBY_LAYOUTS, envelope.layout))) return { ok: false, key: "settingsUi.editorInvalidLayout" };
  const receptionist = envelope.receptionist;
  if (receptionist !== undefined && (!record(receptionist) || !finite(receptionist.a) || !finite(receptionist.b))) return { ok: false, key: "settingsUi.editorInvalidReceptionist" };
  return {
    ok: true,
    value: {
      placements: list,
      ...(envelope.layout === undefined ? {} : { layout: envelope.layout as LobbyLayoutId }),
      ...(receptionist === undefined ? {} : { receptionist: receptionist as { a: number; b: number } }),
    },
  };
}
