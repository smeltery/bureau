import { useTheme } from "../../../store.tsx";
import { hospitalColors, type HospitalColors } from "./palette.ts";

// Both walls rise at the 2:1 isometric slope, so their bottom edges are the two
// lines below. The wainscot is the band above each of them.
const WALL_BOTTOM = {
  left: { x1: -355, y1: 277.5, x2: 120, y2: 40 },
  right: { x1: 120, y1: 40, x2: 595, y2: 277.5 },
} as const;
const WAINSCOT_H = 34;
const RAIL_H = 7;

function Wainscot({ side, c }: { side: "left" | "right"; c: HospitalColors }) {
  const e = WALL_BOTTOM[side];
  const band = `M${e.x1} ${e.y1} L${e.x2} ${e.y2} L${e.x2} ${e.y2 - WAINSCOT_H} L${e.x1} ${e.y1 - WAINSCOT_H} Z`;
  const rail = `M${e.x1} ${e.y1 - WAINSCOT_H + RAIL_H} L${e.x2} ${e.y2 - WAINSCOT_H + RAIL_H} L${e.x2} ${e.y2 - WAINSCOT_H} L${e.x1} ${e.y1 - WAINSCOT_H} Z`;
  return (
    <>
      <path d={band} fill={side === "left" ? c.wainscot : c.wainscotShade} />
      {/* The bumper rail along the top of the band, which is the detail that
          makes a painted band read as a corridor wall rather than a stripe. */}
      <path d={rail} fill={c.rail} />
    </>
  );
}

// The cross sign on the right wall, clear of the clock (240,-85), the neon sign
// (370,-5) and the vent (500,60). Skewed into the wall plane like every other
// prop hung there.
function CrossSign({ c }: { c: HospitalColors }) {
  const arm = 7.5;
  const reach = 19;
  return (
    <g transform="translate(190, -10) skewY(27)">
      <rect x={-reach - 5} y={-reach - 5} width={(reach + 5) * 2} height={(reach + 5) * 2} rx="3" fill={c.crossPlate} stroke={c.crossPlateEdge} strokeWidth="1.2" />
      <path d={`M${-arm} ${-reach} H${arm} V${-arm} H${reach} V${arm} H${arm} V${reach} H${-arm} V${arm} H${-reach} V${-arm} H${-arm} Z`} fill={c.cross} />
    </g>
  );
}

export function HospitalWalls() {
  const { mode } = useTheme();
  const c = hospitalColors(mode);
  return (
    <g aria-hidden="true" data-skin-layer="hospital-walls">
      <Wainscot side="left" c={c} />
      <Wainscot side="right" c={c} />
      <CrossSign c={c} />
    </g>
  );
}
