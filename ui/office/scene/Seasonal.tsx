import { useState } from "react";
import { DESK_SLOTS, isValidDesk } from "../../../shared/desks.ts";
import { SCENE_W, SCENE_H, VB_X, VB_Y, isoXY } from "../grid.ts";
import { useAppState } from "../../store.tsx";

// Calendar-gated office dressing. Chosen once at mount from the local date —
// no setting, no server round-trip, no midnight timer — so a tab left open
// keeps the decorations it started with.
//
// Override with `?officeDate=YYYY-MM-DD` for review, or `?officeDate=all` to
// show every item at once.

export type SeasonalItem = "pumpkin" | "lights" | "valentine";

export const ALL_SEASONAL_ITEMS: SeasonalItem[] = ["pumpkin", "lights", "valentine"];

export function seasonalItems(d: Date): SeasonalItem[] {
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const items: SeasonalItem[] = [];
  if (month === 2 && day === 14) items.push("valentine");
  if (month === 10 && day >= 25) items.push("pumpkin");
  if (month === 12 && day >= 15) items.push("lights");
  return items;
}

export function seasonalItemsFor(search: string, now: Date): SeasonalItem[] {
  const forced = new URLSearchParams(search).get("officeDate");
  if (forced === "all") return ALL_SEASONAL_ITEMS;
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(forced ?? "");
  if (parsed) {
    return seasonalItems(new Date(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3])));
  }
  return seasonalItems(now);
}

const SVG_LAYER: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  pointerEvents: "none",
};
const VB = `${VB_X} ${VB_Y} ${SCENE_W} ${SCENE_H}`;
// Desk sprites sort 10→80; ghosts start at 200. Desk-top props sit in between.
const ON_DESK_Z = 90;

function bezierPoint(p0: number[], c: number[], p1: number[], t: number) {
  const m = 1 - t;
  return [m * m * p0[0] + 2 * m * t * c[0] + t * t * p1[0], m * m * p0[1] + 2 * m * t * c[1] + t * t * p1[1]];
}

// Wall ridge follows Floor.tsx top edges: left (-355,37.5)→(120,-200), right (120,-200)→(595,37.5).
const RIDGE: Array<[number[], number[]]> = [
  [
    [-355, 37.5],
    [120, -200],
  ],
  [
    [120, -200],
    [595, 37.5],
  ],
];
const BULB_COLORS = ["#FFD27A", "#FF7A7A", "#7AE08A", "#7AB8FF", "#FF9ED2"];
const SPANS_PER_WALL = 6;
const SAG = 34;

function StringLights() {
  const wires: React.ReactNode[] = [];
  const bulbs: Array<{ x: number; y: number; color: string; i: number }> = [];
  RIDGE.forEach(([a, b], w) => {
    for (let i = 0; i < SPANS_PER_WALL; i++) {
      const at = (f: number) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      const p0 = at(i / SPANS_PER_WALL);
      const p1 = at((i + 1) / SPANS_PER_WALL);
      const c = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2 + SAG];
      wires.push(<path key={`wire-${w}-${i}`} d={`M${p0[0]} ${p0[1]} Q${c[0]} ${c[1]} ${p1[0]} ${p1[1]}`} fill="none" stroke="#2F3A32" strokeWidth="1.4" />);
      for (const t of [0.25, 0.5, 0.75]) {
        const [x, y] = bezierPoint(p0, c, p1, t);
        const i2 = bulbs.length;
        bulbs.push({ x, y, color: BULB_COLORS[i2 % BULB_COLORS.length], i: i2 });
      }
    }
  });
  return (
    <g aria-hidden="true">
      <defs>
        {BULB_COLORS.map((c, i) => (
          <radialGradient key={i} id={`season-halo-${i}`}>
            <stop offset="0" stopColor={c} stopOpacity="0.55" />
            <stop offset="0.45" stopColor={c} stopOpacity="0.2" />
            <stop offset="1" stopColor={c} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>
      {wires}
      {bulbs.map(({ x, y, color, i }) => (
        <g key={i} transform={`translate(${x},${y})`}>
          <circle className="lamp-glow" cx="0" cy="5" r="13" fill={`url(#season-halo-${i % BULB_COLORS.length})`}>
            <animate attributeName="opacity" values={`${0.55 + (i % 3) * 0.1};1;${0.55 + (i % 3) * 0.1}`} dur={`${2.4 + (i % 4) * 0.7}s`} repeatCount="indefinite" />
          </circle>
          <path d="M-1.5 0 L1.5 0 L1.2 2.6 L-1.2 2.6 Z" fill="#2F3A32" />
          <path d="M0 2.2 C3.4 2.6 3.8 6.2 2.2 7.8 C0.8 9.2 -0.8 9.2 -2.2 7.8 C-3.8 6.2 -3.4 2.6 0 2.2 Z" fill={color} />
          <ellipse cx="-1.1" cy="5" rx="0.9" ry="1.5" fill="#fff" opacity="0.5" transform="rotate(-20 -1.1 5)" />
        </g>
      ))}
    </g>
  );
}

function Pumpkin() {
  return (
    <g transform="scale(0.95)" aria-hidden="true">
      <ellipse cx="1" cy="1" rx="10.5" ry="4" fill="#000" opacity="0.28" />
      <ellipse cx="-4.6" cy="-7" rx="6.4" ry="7.4" fill="#C96A18" />
      <ellipse cx="4.6" cy="-7" rx="6.4" ry="7.4" fill="#A85312" />
      <ellipse cx="0" cy="-7.4" rx="7.8" ry="8" fill="#E8892B" />
      <path d="M-3.4 -13.6 Q0 -15 3.4 -13.6" stroke="#B85E14" strokeWidth="0.7" fill="none" />
      <ellipse cx="-3" cy="-10.4" rx="2.4" ry="1.5" fill="#FFC080" opacity="0.45" transform="rotate(-28 -3 -10.4)" />
      <path d="M-1.5 -14.6 L1.5 -15 L2.4 -20 L-0.6 -20.4 Z" fill="#5E7A3A" />
      <path d="M2 -19.4 Q6.6 -20.6 5.4 -24 Q4.6 -26 2.6 -25" stroke="#6E8A46" strokeWidth="1" fill="none" strokeLinecap="round" />
      <g fill="#6E3208">
        <path d="M-5 -10.6 L-2.2 -9.4 L-5 -8.2 Z" />
        <path d="M1.4 -9.4 L4.2 -10.6 L4.2 -8.2 Z" />
        <path d="M-4.4 -5.6 L-2.6 -4.4 L-0.6 -5.6 L1.4 -4.4 L3.4 -5.6 L2.2 -2.6 L-3.2 -2.6 Z" />
      </g>
      <g className="lamp-glow">
        <ellipse cx="0" cy="-7" rx="9" ry="9" fill="#FF9A2E" opacity="0.16" />
        <g fill="#FFD79A">
          <path d="M-5 -10.6 L-2.2 -9.4 L-5 -8.2 Z" />
          <path d="M1.4 -9.4 L4.2 -10.6 L4.2 -8.2 Z" />
          <path d="M-4.4 -5.6 L-2.6 -4.4 L-0.6 -5.6 L1.4 -4.4 L3.4 -5.6 L2.2 -2.6 L-3.2 -2.6 Z" />
        </g>
      </g>
    </g>
  );
}

const HEART_LID = "M0 4.75 C-12.31 -1.38 -9.4 -8.12 0 -4.15 C9.4 -8.12 12.31 -1.38 0 4.75 Z";
const BOX_H = 6;

function ribbon(dir: [number, number], hw: number): string {
  const [dx, dy] = dir;
  const cy = -BOX_H - 1.7;
  const [ex, ey] = [dx * 20, dy * 20];
  const [nx, ny] = [-dy * hw, dx * hw];
  return `M${-ex + nx} ${cy - ey + ny} L${ex + nx} ${cy + ey + ny} L${ex - nx} ${cy + ey - ny} L${-ex - nx} ${cy - ey - ny} Z`;
}

function ChocolateBox() {
  return (
    <g aria-hidden="true" transform="translate(-3,-2)">
      <defs>
        <clipPath id="season-heart-lid">
          <path d={HEART_LID} transform={`translate(0,${-BOX_H})`} />
        </clipPath>
        <filter id="season-heart-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
      </defs>
      <path d={HEART_LID} transform="translate(0.8,1.1) scale(1.16)" fill="#000" opacity="0.42" filter="url(#season-heart-shadow)" />
      <path d={HEART_LID} fill="#7E1F38" stroke="#3F0E1E" strokeWidth="1" opacity="0.98" />
      <path d={HEART_LID} transform="translate(0,-2.8)" fill="#9C2644" />
      <path d={HEART_LID} transform={`translate(0,${-BOX_H})`} fill="#D13755" />
      <g clipPath="url(#season-heart-lid)">
        <path d={ribbon([0.894, 0.447], 1.5)} fill="#F3E0BE" opacity="0.92" />
        <path d={ribbon([-0.894, 0.447], 1.5)} fill="#E2CDA6" opacity="0.92" />
      </g>
      <path d={HEART_LID} transform={`translate(0,${-BOX_H})`} fill="none" stroke="#F0637C" strokeWidth="0.9" opacity="0.7" />
      <ellipse cx="-5.5" cy="-10" rx="3.4" ry="1.5" fill="#fff" opacity="0.2" transform="rotate(-16 -5.5 -10)" />
    </g>
  );
}

export function Seasonal() {
  const { agents, currentRoom } = useAppState();
  const [items] = useState(() => seasonalItemsFor(typeof location === "undefined" ? "" : location.search, new Date()));
  if (items.length === 0) return null;

  // Front-most occupied desk (highest index) gets desk-top props so a single
  // overlay layer never covers a desk that should sit in front of the prop.
  const occupied = agents.filter((a) => a.room === currentRoom && isValidDesk(a.desk)).map((a) => a.desk);
  const deskAnchor = occupied.length === 0 ? null : Math.max(...occupied);
  let anchor: [number, number] | null = null;
  if (deskAnchor !== null) {
    const slot = DESK_SLOTS[deskAnchor];
    const { x, y } = isoXY(slot.row, slot.col);
    // East corner of the desktop in sprite-local coords (138,64); floor contact (90,116).
    anchor = [x + 138 - 90, y + 64 - 116];
  }

  const showLights = items.includes("lights");
  const showDeskProps = anchor !== null && (items.includes("pumpkin") || items.includes("valentine"));

  return (
    <>
      {showLights && (
        <svg style={SVG_LAYER} width={SCENE_W} height={SCENE_H} viewBox={VB} overflow="visible">
          <StringLights />
        </svg>
      )}
      {showDeskProps && anchor && (
        <svg style={{ ...SVG_LAYER, zIndex: ON_DESK_Z }} width={SCENE_W} height={SCENE_H} viewBox={VB} overflow="visible">
          <g transform={`translate(${anchor[0]},${anchor[1]})`}>
            {items.includes("pumpkin") && <Pumpkin />}
            {items.includes("valentine") && <ChocolateBox />}
          </g>
        </svg>
      )}
    </>
  );
}
