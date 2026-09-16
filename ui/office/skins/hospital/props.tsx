import { useTheme } from "../../../store.tsx";
import { hospitalColors, type HospitalColors } from "./palette.ts";

// --- Floor props -----------------------------------------------------------

// Half-length from the middle of a bed to its foot, and half-width to its side,
// both on the floor axes: the head is up-right against the back-right wall and
// the foot points down-left into the room.
export const BED_U = { x: -40, y: 20 };
export const BED_V = { x: 18, y: 9 };
export const BED_H = 20;
export const HEAD_RAIL = 24;
const FOOT_RAIL = 16;

// Contact points on the floor, listed back to front (paint order). Beds stand
// clear of all eight desk footprints along the front-right floor edge —
// desks draw after this layer, so overlap paints over the bed. layout.test.ts
// holds the numbers.
export const PLACEMENT = {
  curtain: { x: 384, y: 362 },
  bedFar: { x: 300, y: 400 },
  ivStand: { x: 246, y: 432 },
  bedNear: { x: 180, y: 460 },
} as const;

export const BED_SPOTS = ["bedFar", "bedNear"] as const;

/** Floor rectangle of a bed, widened to the frame and raised to the head rail. */
export function bedBox(at: { x: number; y: number }) {
  const halfX = -BED_U.x + BED_V.x;
  const halfY = BED_U.y + BED_V.y;
  return {
    minX: at.x - halfX,
    maxX: at.x + halfX,
    minY: at.y - halfY - BED_H - HEAD_RAIL,
    maxY: at.y + halfY,
  };
}

function point(c: { x: number; y: number }, u: number, v: number) {
  return {
    x: c.x + BED_U.x * u + BED_V.x * v,
    y: c.y + BED_U.y * u + BED_V.y * v,
  };
}

function poly(pts: Array<{ x: number; y: number }>, lift = 0) {
  return pts.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y - lift}`).join(" ") + " Z";
}

/** One bed: a mattress on a frame, a pillow at the head, a blanket over the
 *  foot half, and a rail at each end. Drawn from the two floor axes, so it
 *  stands on the grid the tiles and the desks stand on. */
function Bed({ at, c }: { at: { x: number; y: number }; c: HospitalColors }) {
  const foot = point(at, 1, 0);
  const head = point(at, -1, 0);
  // Floor rectangle, then the same rectangle lifted to mattress height.
  const corners = [point(at, 1, 1), point(at, 1, -1), point(at, -1, -1), point(at, -1, 1)];
  const [nearFoot, farFoot, farHead, nearHead] = corners;
  return (
    <g aria-hidden="true">
      {/* Contact shadow */}
      <ellipse cx={at.x} cy={at.y + 4} rx="48" ry="24" fill={c.shadow} filter="url(#hospital-soft)" />
      {/* The two faces of the frame that face the viewer */}
      <path d={`M${nearFoot.x} ${nearFoot.y} L${nearHead.x} ${nearHead.y} L${nearHead.x} ${nearHead.y - BED_H} L${nearFoot.x} ${nearFoot.y - BED_H} Z`} fill={c.frameShade} />
      <path d={`M${nearFoot.x} ${nearFoot.y} L${farFoot.x} ${farFoot.y} L${farFoot.x} ${farFoot.y - BED_H} L${nearFoot.x} ${nearFoot.y - BED_H} Z`} fill={c.frame} />
      {/* Mattress top */}
      <path d={poly(corners, BED_H)} fill={c.mattress} />
      {/* The sheet, inset so the mattress shows as a lip around it */}
      <path d={poly([point(at, 0.88, 0.86), point(at, 0.88, -0.86), point(at, -0.88, -0.86), point(at, -0.88, 0.86)], BED_H + 3)} fill={c.linen} />
      {/* Blanket over the foot half, with its own hanging edge */}
      <path d={poly([point(at, 0.9, 0.9), point(at, 0.9, -0.9), point(at, 0.05, -0.9), point(at, 0.05, 0.9)], BED_H + 5)} fill={c.blanket} />
      <path
        d={`M${point(at, 0.9, 0.9).x} ${point(at, 0.9, 0.9).y - BED_H - 5} L${point(at, 0.9, -0.9).x} ${point(at, 0.9, -0.9).y - BED_H - 5} L${point(at, 0.9, -0.9).x} ${point(at, 0.9, -0.9).y - BED_H + 5} L${point(at, 0.9, 0.9).x} ${point(at, 0.9, 0.9).y - BED_H + 5} Z`}
        fill={c.blanketShade}
      />
      {/* Pillow at the head */}
      <path d={poly([point(at, -0.5, 0.62), point(at, -0.5, -0.62), point(at, -0.86, -0.62), point(at, -0.86, 0.62)], BED_H + 9)} fill={c.pillow} />
      <path d={poly([point(at, -0.5, 0.62), point(at, -0.5, -0.62), point(at, -0.86, -0.62), point(at, -0.86, 0.62)], BED_H + 3)} fill={c.linenShade} opacity="0.5" />
      {/* Head and foot rails: two posts and three bars each */}
      {[
        { end: head, h: HEAD_RAIL, u: -1 },
        { end: foot, h: FOOT_RAIL, u: 1 },
      ].map(({ end, h, u }) => {
        const a = point(at, u, 1);
        const b = point(at, u, -1);
        return (
          <g key={u}>
            <rect x={a.x - 2} y={a.y - BED_H - h} width="4" height={h + BED_H} rx="1.6" fill={c.metal} />
            <rect x={b.x - 2} y={b.y - BED_H - h} width="4" height={h + BED_H} rx="1.6" fill={c.metalShade} />
            {[0, 0.42, 0.84].map((t) => (
              <path key={t} d={`M${a.x} ${a.y - BED_H - h + t * h} L${b.x} ${b.y - BED_H - h + t * h}`} stroke={c.metal} strokeWidth="2.6" strokeLinecap="round" fill="none" />
            ))}
            {/* The near post, drawn last so it reads as being in front */}
            <circle cx={end.x} cy={end.y - BED_H - h} r="2.2" fill={c.metal} />
          </g>
        );
      })}
      {/* Castors */}
      {[nearFoot, farFoot, nearHead, farHead].map((p, i) => (
        <ellipse key={i} cx={p.x} cy={p.y - 2} rx="3.4" ry="2" fill={c.metalShade} />
      ))}
    </g>
  );
}

/** The drip stand beside the far bed: a wheeled base, a pole, a hook and a
 *  half-full bag with its line running down. */
function IvStand({ at, c }: { at: { x: number; y: number }; c: HospitalColors }) {
  const poleTop = at.y - 88;
  return (
    <g aria-hidden="true">
      <ellipse cx={at.x} cy={at.y + 1} rx="13" ry="6.5" fill={c.shadow} filter="url(#hospital-soft)" />
      {/* Base: three feet on the floor plane */}
      {[
        { dx: -14, dy: 7 },
        { dx: 14, dy: 7 },
        { dx: 0, dy: -7 },
      ].map((f, i) => (
        <path key={i} d={`M${at.x} ${at.y} L${at.x + f.dx} ${at.y + f.dy} `} stroke={c.metalShade} strokeWidth="2.6" strokeLinecap="round" />
      ))}
      <rect x={at.x - 1.6} y={poleTop} width="3.2" height={at.y - poleTop} rx="1.4" fill={c.metal} />
      <path d={`M${at.x} ${poleTop + 3} L${at.x + 9} ${poleTop + 3}`} stroke={c.metal} strokeWidth="2.4" strokeLinecap="round" fill="none" />
      {/* Bag, hung off the hook, and the line down from it */}
      <path d={`M${at.x + 4} ${poleTop + 7} h13 v24 q0 5 -6.5 5 q-6.5 0 -6.5 -5 Z`} fill={c.fluid} stroke={c.metalShade} strokeWidth="0.9" />
      {/* The fluid line across it: what makes a rounded rectangle read as a
          half-full bag rather than a label. */}
      <path d={`M${at.x + 4} ${poleTop + 16} h13`} stroke={c.metalShade} strokeWidth="0.8" opacity="0.75" />
      <path d={`M${at.x + 10} ${poleTop + 36} q3 18 -8 28`} stroke={c.metalShade} strokeWidth="1" fill="none" strokeLinecap="round" />
    </g>
  );
}

/** The cubicle curtain, gathered against its rail beside the far bed's head -
 *  which is how a curtain stands when nobody has pulled it round. */
function Curtain({ at, c }: { at: { x: number; y: number }; c: HospitalColors }) {
  const top = at.y - 100;
  // The rail runs along the floor axis the beds are laid on, so the curtain
  // hangs square to them rather than across the grid, and each fold hangs from
  // its own point on it - a flat top line reads as a board, not cloth.
  const width = 44;
  const drop = 92;
  const folds = [0, 0.25, 0.5, 0.75, 1];
  return (
    <g aria-hidden="true">
      <path d={`M${at.x - width / 2 - 6} ${top - 3 - width / 4} L${at.x + width / 2 + 6} ${top + 3 + width / 4}`} stroke={c.metalShade} strokeWidth="3" strokeLinecap="round" />
      {/* One panel behind the folds, so the gaps between them are cloth and
          not floor. */}
      <path
        d={`M${at.x - width / 2} ${top - width / 4} L${at.x + width / 2} ${top + width / 4} L${at.x + width / 2} ${top + width / 4 + drop} L${at.x - width / 2} ${top - width / 4 + drop} Z`}
        fill={c.curtainShade}
      />
      {folds.map((t, i) => {
        const x = at.x - width / 2 + t * width;
        const y = top - width / 4 + t * (width / 2);
        const sway = i % 2 ? 2.5 : -2.5;
        return <path key={t} d={`M${x} ${y} q${sway} ${drop / 2} ${-sway * 0.5} ${drop} l6 0 q${sway * 0.5} ${-drop} ${-sway} ${-drop} Z`} fill={i % 2 ? c.curtain : c.curtainShade} />;
      })}
      {/* The hem, which is where a curtain stops looking like a wall. */}
      <path
        d={`M${at.x - width / 2} ${top - width / 4 + drop} q${width / 4} ${8} ${width / 2} ${width / 4} q${width / 4} ${width / 4 - 8} ${width / 2} ${width / 4}`}
        fill="none"
        stroke={c.curtain}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </g>
  );
}

export function HospitalProps() {
  const { mode } = useTheme();
  const c = hospitalColors(mode);
  return (
    <g data-skin-layer="hospital-props">
      <defs>
        <filter id="hospital-soft" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3.2" />
        </filter>
      </defs>
      {/* Drawn back to front: the far bed and its furniture first, then the
          bed nearer the viewer. */}
      <Curtain at={PLACEMENT.curtain} c={c} />
      <Bed at={PLACEMENT.bedFar} c={c} />
      <IvStand at={PLACEMENT.ivStand} c={c} />
      <Bed at={PLACEMENT.bedNear} c={c} />
    </g>
  );
}
