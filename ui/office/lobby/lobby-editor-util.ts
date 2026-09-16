// Shared helpers for the lobby layout editor (dev art tool, ?lobbyEdit=1).
import { VB_X, VB_Y } from "../grid.ts";
import { floorXY } from "./geometry.ts";
import type { Placement } from "./layouts.ts";

export interface EditorItem extends Placement {
  key: number;
}

export function roundCoord(n: number) {
  return Math.round(n * 100) / 100;
}

export function anchorPx(p: Placement): { left: number; top: number } {
  const { x, y } = floorXY(p.b, p.a);
  return { left: x - VB_X, top: y - VB_Y - (p.wall ? (p.h ?? 60) : 0) };
}

/** TypeScript snippet for pasting into layouts.ts. */
export function exportLayoutTs(items: EditorItem[], recep: { a: number; b: number }): string {
  const lines = items.map((p) => {
    const parts = [`family: "${p.family}"`, `variant: "${p.variant}"`, `a: ${roundCoord(p.a)}`, `b: ${roundCoord(p.b)}`];
    if (p.wall) parts.push(`wall: "${p.wall}"`, `h: ${roundCoord(p.h ?? 60)}`);
    if (p.facing) parts.push(`facing: "${p.facing}"`);
    if (p.flip) parts.push("flip: true");
    if (p.z) parts.push(`z: ${roundCoord(p.z)}`);
    if (p.scale && p.scale !== 1) parts.push(`scale: ${roundCoord(p.scale)}`);
    return `      { ${parts.join(", ")} },`;
  });
  return `    receptionist: { a: ${roundCoord(recep.a)}, b: ${roundCoord(recep.b)} },\n    placements: [\n${lines.join("\n")}\n    ],`;
}

export function placementsJson(items: EditorItem[], recep: { a: number; b: number }): string {
  return JSON.stringify({ receptionist: recep, placements: items.map(({ key: _k, ...p }) => p) }, null, 2);
}
