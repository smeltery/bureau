// Beds draw before desks. An occupied desk that overlaps a bed paints over it —
// which is the defect this file exists to keep out.

import { expect, test } from "bun:test";
import { DESK_SLOTS } from "../../../../shared/desks.ts";
import { isoXY } from "../../grid.ts";
import { BED_SPOTS, BED_U, BED_V, PLACEMENT, bedBox } from "./props.tsx";

// Solid furniture ink of one occupied desk, as an offset from its floor point
// (soft floor shadow excluded — beds may stand on that).
const DESK_INK = { left: 70, right: 70, up: 123, down: 5 };

function deskBox(slot: { row: number; col: number }) {
  const { x, y } = isoXY(slot.row, slot.col);
  return {
    minX: x - DESK_INK.left,
    maxX: x + DESK_INK.right,
    minY: y - DESK_INK.up,
    maxY: y + DESK_INK.down,
  };
}

interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function overlaps(a: Box, b: Box): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

test("no bed stands where an occupied desk would paint over it", () => {
  for (const spot of BED_SPOTS) {
    const bed = bedBox(PLACEMENT[spot]);
    for (const [i, slot] of DESK_SLOTS.entries()) {
      expect({ spot, desk: i + 1, hit: overlaps(bed, deskBox(slot)) }).toEqual({
        spot,
        desk: i + 1,
        hit: false,
      });
    }
  }
});

const FLOOR = {
  back: { x: 120, y: 40 },
  left: { x: -355, y: 277.5 },
  right: { x: 595, y: 277.5 },
  front: { x: 120, y: 515 },
};

function onFloor(p: { x: number; y: number }): boolean {
  return (
    p.y >= FLOOR.back.y + Math.abs(p.x - FLOOR.back.x) / 2 &&
    p.y <= FLOOR.front.y - Math.abs(p.x - FLOOR.front.x) / 2 &&
    p.x >= FLOOR.left.x + Math.abs(p.y - FLOOR.left.y) * 2 &&
    p.x <= FLOOR.right.x - Math.abs(p.y - FLOOR.right.y) * 2
  );
}

test("every bed stands with all four castors on the floor", () => {
  for (const spot of BED_SPOTS) {
    const at = PLACEMENT[spot];
    const corners = [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1],
    ].map(([u, v]) => ({
      x: at.x + BED_U.x * u + BED_V.x * v,
      y: at.y + BED_U.y * u + BED_V.y * v,
    }));
    for (const [i, corner] of corners.entries()) {
      expect({ spot, corner: i, on: onFloor(corner) }).toEqual({
        spot,
        corner: i,
        on: true,
      });
    }
  }
});

test("the furniture is listed back to front", () => {
  const depths = Object.values(PLACEMENT).map((p) => p.y);
  expect(depths).toEqual([...depths].sort((a, b) => a - b));
});
