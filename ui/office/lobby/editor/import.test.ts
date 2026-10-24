import { expect, test } from "bun:test";
import { importLayout } from "./import.ts";
import { LOBBY_LAYOUTS } from "../layouts.ts";
import { placementsJson, exportLayoutTs } from "../lobby-editor-util.ts";

test("layout import round trips every bundled layout without translating identifiers", () => {
  for (const layout of Object.values(LOBBY_LAYOUTS)) {
    const items = layout.placements.map((item, key) => ({ ...item, key }));
    expect(importLayout(placementsJson(items, layout.receptionist))).toEqual({ ok: true, value: { placements: layout.placements, receptionist: layout.receptionist } });
    const result = importLayout(JSON.stringify({ layout: layout.id, placements: layout.placements, receptionist: layout.receptionist }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.layout).toBe(layout.id);
      expect(
        exportLayoutTs(
          result.value.placements.map((item, key) => ({ ...item, key })),
          result.value.receptionist!,
        ),
      ).toBe(exportLayoutTs(items, layout.receptionist));
    }
    expect(importLayout(JSON.stringify(layout.placements))).toEqual({ ok: true, value: { placements: layout.placements } });
  }
  expect(importLayout("[]")).toEqual({ ok: true, value: { placements: [] } });
});

test("layout import rejects invalid data before it can reach the scene or prop controls", () => {
  const valid = LOBBY_LAYOUTS.fireside.placements[0]!;
  for (const value of [
    null,
    {},
    { ...valid, family: "missing" },
    { ...valid, variant: "missing" },
    { ...valid, a: "1" },
    { ...valid, scale: null },
    { ...valid, wall: "ceiling" },
    { ...valid, flip: 1 },
    { ...valid, facing: ["SE"] },
    { ...valid, facing: "S" },
  ]) {
    expect(importLayout(JSON.stringify([value]))).toEqual({ ok: false, key: "settingsUi.editorInvalidPlacement" });
  }
  expect(importLayout(JSON.stringify([{ ...valid, a: 0 }]).replace('"a":0', '"a":1e999')).ok).toBe(false);
  expect(importLayout("null")).toEqual({ ok: false, key: "settingsUi.editorMissing" });
  expect(importLayout("{")).toEqual({ ok: false, key: "settingsUi.editorInvalid" });
  expect(importLayout('{"placements":[],"layout":"toString"}')).toEqual({ ok: false, key: "settingsUi.editorInvalidLayout" });
  expect(importLayout('{"placements":[],"receptionist":{"a":1,"b":"2"}}')).toEqual({ ok: false, key: "settingsUi.editorInvalidReceptionist" });
});
