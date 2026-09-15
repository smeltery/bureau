import type { PresenceInfo } from "../../../shared/types.ts";
import { LobbyGhosts, lobbyGhostPlacements } from "./LobbyGhosts.tsx";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { SCENE_W, SCENE_H } from "../grid.ts";
import { WallDoor, type DoorProps } from "../scene/WallDoor.tsx";
import type { ThemeMode } from "../../themes/index.ts";
import { VB, SVG_STYLE, FLOOR_BACK, FLOOR_LEFT, FLOOR_RIGHT, ROW, COL, TILES, SLAB_H, OUTER_LEFT, OUTER_RIGHT, WALL_APEX, WALL_TOP_Y, floorXY } from "./geometry.ts";
import { lobbyColors, type LobbyColors } from "./palette.ts";
import { ContactShadow, ShadowDefs, shade, wallTransform } from "./iso.tsx";
import { findVariant, PropDefs, variantFacings, type PropStar } from "./props.tsx";
import { LOBBY_LAYOUTS, type LobbyLayoutId, type Placement } from "./layouts.ts";

// The lobby: an agent-free room drawn in the office's isometric space. It
// takes everything it needs as props (no store import) so a parent can mount
// it standalone. ReceptionistFigure wiring stays with the parent.

export type { LobbyLayoutId };

export interface LobbyRoomRef {
  id: string;
  name: string;
}

export interface LobbySceneProps {
  rooms: LobbyRoomRef[];
  presences?: PresenceInfo[];
  ownConnectionId?: string | null;
  onMoveGhost?: (spotId: string) => void;
  onOpenUser?: (userId: string) => void;
  officeName: string | null;
  mode: ThemeMode;
  layout?: LobbyLayoutId | "empty";
  // Employee of the Minute, office-wide. Null hides the plaque portrait.
  star?: PropStar | null;
  // Per-family variant overrides, e.g. { sofa: "loveseat" }.
  variants?: Record<string, string>;
  // The receptionist, drawn at the layout's slot with its feet at the origin.
  receptionist?: ReactNode;
  // Editor overrides: a live placement list and receptionist slot.
  placements?: Placement[];
  receptionistAt?: { a: number; b: number };
  // The doorway on the right wall, which leads to the first room.
  rightDoor?: { label: string; onClick: () => void } | null;
  onToggleTheme?: () => void;
  onOpenApps?: () => void;
  onOpenCronjobs?: () => void;
  // When false, skip floor planks and prop furniture (walls/ghosts still draw).
  decorateScene?: boolean;
}

export function LobbyScene({
  rooms,
  presences = [],
  onMoveGhost,
  onOpenUser,
  officeName,
  star = null,
  mode,
  layout = "fireside",
  variants,
  receptionist,
  placements,
  receptionistAt,
  rightDoor,
  onToggleTheme,
  onOpenApps,
  onOpenCronjobs,
  decorateScene = true,
}: LobbySceneProps) {
  const c = lobbyColors(mode);
  const base = layout === "empty" ? null : LOBBY_LAYOUTS[layout];
  const naturalGhostPlacements = useMemo(() => lobbyGhostPlacements(presences, base?.ghostSpots ?? []), [presences, base]);
  const spec =
    placements || receptionistAt
      ? {
          placements: placements ?? base?.placements ?? [],
          receptionist: receptionistAt ?? base?.receptionist ?? { a: 5, b: 5 },
        }
      : base;
  return (
    <>
      <LobbyWalls c={c} onToggleTheme={onToggleTheme} onOpenApps={onOpenApps} onOpenCronjobs={onOpenCronjobs} />
      {decorateScene && <LobbyFloor c={c} />}
      {rightDoor && <LobbyWallDoors rightDoor={rightDoor} />}
      {spec && (decorateScene || receptionist) && (
        <LobbyProps
          placements={decorateScene ? spec.placements : []}
          variants={variants}
          rooms={rooms}
          officeName={officeName?.trim() || "the office"}
          mode={mode}
          star={star}
          receptionist={receptionist ? { ...spec.receptionist, node: receptionist } : undefined}
        />
      )}
      <LobbyGhosts placements={naturalGhostPlacements} naturalPlacements={naturalGhostPlacements} presences={presences} spots={base?.ghostSpots ?? []} onMove={onMoveGhost} onOpenUser={onOpenUser} />
    </>
  );
}

// --- Inlined day-scene bits (Bureau Floor.tsx does not export these yet) ---

function SunRays() {
  return (
    <>
      <defs>
        <linearGradient id="lobby-sunray-wide" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff4b8" stopOpacity="0" />
          <stop offset="0.22" stopColor="#fff4b8" stopOpacity="0.2" />
          <stop offset="1" stopColor="#fff4b8" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="lobby-sunray-narrow" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff9d8" stopOpacity="0" />
          <stop offset="0.2" stopColor="#fff9d8" stopOpacity="0.16" />
          <stop offset="1" stopColor="#fff9d8" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g className="sunrays" aria-hidden="true">
        <path d="M-205 -5 L18 350 L-38 361 Z" fill="url(#lobby-sunray-wide)" opacity="0.5" />
        <path d="M-205 -5 L125 344 L55 361 Z" fill="url(#lobby-sunray-wide)" opacity="0.55" />
        <path d="M-205 -5 L232 296 L174 324 Z" fill="url(#lobby-sunray-narrow)" opacity="0.65" />
      </g>
    </>
  );
}

const CLOUD_PUFFS: Array<[number, number]> = [
  [-12.5, 4.6],
  [-6.5, 7],
  [0.5, 8.6],
  [7, 6.4],
  [12.5, 4.8],
];

function CloudBody({ fill }: { fill: string }) {
  return (
    <g fill={fill}>
      {CLOUD_PUFFS.map(([dx, r], i) => (
        <circle key={i} cx={dx} cy={-r} r={r} />
      ))}
      <rect x={-13} y={-4.2} width={26.3} height={4.2} />
    </g>
  );
}

function Cloud({ x, y, scale, opacity }: { x: number; y: number; scale: number; opacity: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`} opacity={opacity}>
      <CloudBody fill="#B7D2E7" />
      <g transform="translate(-1.5 0) scale(0.92)">
        <CloudBody fill="#E4EFF8" />
      </g>
      <g transform="translate(-4 0) scale(0.72)">
        <CloudBody fill="#FFFFFF" />
      </g>
    </g>
  );
}

function LobbyWallDoors({ rightDoor }: { rightDoor: DoorProps }) {
  return (
    <svg style={SVG_STYLE} width={SCENE_W} height={SCENE_H} viewBox={VB} overflow="visible">
      <WallDoor side="right" door={rightDoor} />
    </svg>
  );
}

function AppsWallScreen({ onOpenApps }: { onOpenApps?: () => void }) {
  return (
    <g
      data-no-pan
      transform="translate(50, -75) skewY(-27)"
      onClick={onOpenApps}
      aria-label={onOpenApps ? "Apps" : undefined}
      style={onOpenApps ? { cursor: "pointer", pointerEvents: "auto" } : undefined}
    >
      {onOpenApps && <title>Apps</title>}
      <rect x="-30" y="-32" width="60" height="58" rx="3" fill="var(--wall-decor)" stroke="var(--wall-decor-stroke)" strokeWidth="1.2" />
      <rect x="-25" y="-27" width="50" height="46" rx="1.5" fill="var(--bg-surface-solid, #1a1a1a)" stroke="var(--wall-decor-stroke)" strokeWidth="0.6" />
      <g fill="var(--accent)" opacity="0.85">
        <rect x="-9" y="-19" width="7" height="7" rx="1" />
        <rect x="2" y="-19" width="7" height="7" rx="1" />
        <rect x="-9" y="-8" width="7" height="7" rx="1" />
        <rect x="2" y="-8" width="7" height="7" rx="1" />
      </g>
      <text x="0" y="13" textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--text-primary)" style={{ userSelect: "none" }}>
        Apps
      </text>
    </g>
  );
}

// Window pane on the left wall, same parallelogram as the office window.
const PANE = "M-290 111 L-149 40.5 L-149 -45.5 L-290 25 Z";
const STAR_UV: Array<[number, number, number]> = [
  [0.1, 0.2, 0.6],
  [0.3, 0.1, 0.9],
  [0.5, 0.3, 0.5],
  [0.8, 0.15, 0.7],
  [0.15, 0.5, 0.5],
  [0.4, 0.4, 0.8],
  [0.65, 0.2, 0.6],
  [0.9, 0.35, 0.5],
  [0.2, 0.75, 0.9],
  [0.45, 0.6, 0.6],
  [0.7, 0.5, 0.7],
  [0.85, 0.7, 0.5],
  [0.05, 0.9, 0.5],
  [0.35, 0.8, 0.7],
  [0.6, 0.75, 0.6],
  [0.95, 0.55, 0.8],
  [0.25, 0.35, 0.5],
  [0.55, 0.85, 0.6],
  [0.75, 0.4, 0.7],
  [0.1, 0.65, 0.5],
];

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function LobbyWalls({ c, onToggleTheme, onOpenApps, onOpenCronjobs }: { c: LobbyColors; onToggleTheme?: () => void; onOpenApps?: () => void; onOpenCronjobs?: () => void }) {
  const L = FLOOR_LEFT;
  const R = FLOOR_RIGHT;
  const A = WALL_APEX;
  const B = FLOOR_BACK;
  const BB = 9;
  const now = useClock();
  const hours = now.getHours() % 12;
  const minutes = now.getMinutes();
  const hourAngle = (hours + minutes / 60) * 30;
  const minuteAngle = minutes * 6;
  const CR = 24;
  const cr = CR * 0.83;
  const hLen = cr * 0.55;
  const mLen = cr * 0.78;
  const hx = hLen * Math.sin((hourAngle * Math.PI) / 180);
  const hy = -hLen * Math.cos((hourAngle * Math.PI) / 180);
  const mx = mLen * Math.sin((minuteAngle * Math.PI) / 180);
  const my = -mLen * Math.cos((minuteAngle * Math.PI) / 180);
  const moonPhase = (now.getDate() / 30) * 2 - 1;
  const stars = STAR_UV.map(([u, v, r]) => {
    const topY = 25 + u * (-45 - 25);
    const botY = 115 + u * (45 - 115);
    return [-285 + u * 140, topY + v * (botY - topY), r] as [number, number, number];
  });

  return (
    <svg style={SVG_STYLE} width={SCENE_W} height={SCENE_H} viewBox={VB} overflow="visible">
      <defs>
        <linearGradient id="lobby-wall-left" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c.wallLeftTop} />
          <stop offset="1" stopColor={c.wallLeftBot} />
        </linearGradient>
        <linearGradient id="lobby-wall-right" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c.wallRightTop} />
          <stop offset="1" stopColor={c.wallRightBot} />
        </linearGradient>
        <clipPath id="lobby-window-clip">
          <path d={PANE} />
        </clipPath>
        <radialGradient id="lobby-moon-halo">
          <stop offset="0" stopColor="#E8E0C8" stopOpacity="0.18" />
          <stop offset="0.4" stopColor="#E8E0C8" stopOpacity="0.1" />
          <stop offset="0.7" stopColor="#E8E0C8" stopOpacity="0.03" />
          <stop offset="1" stopColor="#E8E0C8" stopOpacity="0" />
        </radialGradient>
        <mask id="lobby-moon-crescent">
          <circle cx={-203} cy={-8} r={12} fill="#fff" />
          <circle cx={-203 + moonPhase * 10} cy={-9} r={10} fill="#000" />
        </mask>
      </defs>

      <path d={`M${L.x} ${WALL_TOP_Y} L${L.x} ${L.y} L${OUTER_LEFT.x} ${OUTER_LEFT.y} L${OUTER_LEFT.x} ${WALL_TOP_Y - 4.5} Z`} fill={c.wallEndLeft} stroke={c.wallStroke} strokeWidth="0.5" />
      <path d={`M${R.x} ${WALL_TOP_Y} L${R.x} ${R.y} L${OUTER_RIGHT.x} ${OUTER_RIGHT.y} L${OUTER_RIGHT.x} ${WALL_TOP_Y - 4.5} Z`} fill={c.wallEndRight} stroke={c.wallStroke} strokeWidth="0.5" />
      <path d={`M${L.x} ${WALL_TOP_Y} L${A.x} ${A.y} L${A.x} ${A.y - 9} L${OUTER_LEFT.x} ${WALL_TOP_Y - 4.5} Z`} fill={c.wallTopLeft} stroke={c.wallStroke} strokeWidth="0.5" />
      <path d={`M${A.x} ${A.y} L${R.x} ${WALL_TOP_Y} L${OUTER_RIGHT.x} ${WALL_TOP_Y - 4.5} L${A.x} ${A.y - 9} Z`} fill={c.wallTopRight} stroke={c.wallStroke} strokeWidth="0.5" />

      <path d={`M${L.x} ${L.y} L${L.x} ${WALL_TOP_Y} L${A.x} ${A.y} L${B.x} ${B.y} Z`} fill="url(#lobby-wall-left)" stroke={c.wallStroke} strokeWidth="0.5" />
      <path d={`M${A.x} ${A.y} L${B.x} ${B.y} L${R.x} ${R.y} L${R.x} ${WALL_TOP_Y} Z`} fill="url(#lobby-wall-right)" stroke={c.wallStroke} strokeWidth="0.5" />

      <path d={`M${L.x} ${L.y} L${B.x} ${B.y} L${B.x} ${B.y - BB} L${L.x} ${L.y - BB} Z`} fill={c.baseboard} />
      <path d={`M${B.x} ${B.y} L${R.x} ${R.y} L${R.x} ${R.y - BB} L${B.x} ${B.y - BB} Z`} fill={c.baseboardShade} />

      <g
        data-no-pan
        role={onToggleTheme ? "button" : undefined}
        tabIndex={onToggleTheme ? 0 : undefined}
        aria-label={onToggleTheme ? "Change theme" : undefined}
        onClick={onToggleTheme}
        onMouseDown={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggleTheme?.();
          }
        }}
        style={onToggleTheme ? { cursor: "pointer", pointerEvents: "auto" } : undefined}
      >
        <path d="M-290 120 L-140 45 L-140 -50 L-290 25 Z" fill={c.wallEndLeft} stroke={c.wallStroke} strokeWidth="0.5" />
        <path d="M-140 45 L-140 -50 L-149 -45.5 L-149 40.5 Z" fill={c.wallTopLeft} stroke={c.wallStroke} strokeWidth="0.5" />
        <g clipPath="url(#lobby-window-clip)" className="window-night">
          <path d={PANE} fill="#0a0e1a" />
          {stars.map(([sx, sy, sr], i) => (
            <circle key={i} cx={sx} cy={sy} r={sr} fill="white" opacity={0.4 + (i % 4) * 0.15}>
              {i % 5 === 0 && <animate attributeName="opacity" values={`${0.3 + (i % 3) * 0.1};${0.7 + (i % 2) * 0.2};${0.3 + (i % 3) * 0.1}`} dur={`${2 + (i % 3)}s`} repeatCount="indefinite" />}
            </circle>
          ))}
          <circle cx={-203} cy={-8} r={30} fill="url(#lobby-moon-halo)" />
          <circle cx={-203} cy={-8} r={12} fill="#E8E0C8" mask="url(#lobby-moon-crescent)" />
        </g>
        <g clipPath="url(#lobby-window-clip)" className="window-day">
          <path d={PANE} fill="#87CEEB" />
          <circle cx={-205} cy={-5} r={14} fill="#F5D060" />
          <circle cx={-205} cy={-5} r={20} fill="#F5D060" opacity="0.15" />
          <Cloud x={-250} y={22} scale={0.9} opacity={0.95} />
          <Cloud x={-172} y={4} scale={1.05} opacity={0.92} />
          <Cloud x={-262} y={66} scale={0.6} opacity={0.68} />
        </g>
        <path d="M-290 111 L-149 40.5" stroke={c.frame} strokeWidth="2" />
        <path d="M-149 40.5 L-149 -45.5" stroke={c.frame} strokeWidth="2" />
        <line x1={-215} y1={73.5} x2={-215} y2={-12.5} stroke={c.frame} strokeWidth="2" />
        <path d="M-290 68 L-149 -2.5" stroke={c.frame} strokeWidth="2" fill="none" />
      </g>

      <AppsWallScreen onOpenApps={onOpenApps} />
      <g
        transform="translate(240,-85) skewY(27)"
        data-no-pan
        aria-label={onOpenCronjobs ? "Schedules" : undefined}
        onClick={onOpenCronjobs}
        style={onOpenCronjobs ? { cursor: "pointer", pointerEvents: "auto" } : undefined}
      >
        {onOpenCronjobs && <title>Schedules</title>}
        <circle cx="0" cy="0" r={CR} fill={c.clockFace} stroke={c.clockTick} strokeWidth="1" />
        <circle cx="0" cy="0" r={cr} fill={c.clockInner} />
        {Array.from({ length: 12 }, (_, i) => {
          const a = (i * 30 * Math.PI) / 180;
          return (
            <line
              key={i}
              x1={(cr - 2) * Math.sin(a)}
              y1={-(cr - 2) * Math.cos(a)}
              x2={(cr - 5) * Math.sin(a)}
              y2={-(cr - 5) * Math.cos(a)}
              stroke={c.clockTick}
              strokeWidth={i % 3 === 0 ? 1.2 : 0.6}
            />
          );
        })}
        <line x1="0" y1="0" x2={hx} y2={hy} stroke={c.clockHand} strokeWidth="1.5" strokeLinecap="round" />
        <line x1="0" y1="0" x2={mx} y2={my} stroke={c.clockHand} strokeWidth="1" strokeLinecap="round" />
        <circle cx="0" cy="0" r="1.5" fill={c.clockHand} />
      </g>
    </svg>
  );
}

function LobbyFloor({ c }: { c: LobbyColors }) {
  return (
    <svg style={SVG_STYLE} width={SCENE_W} height={SCENE_H} viewBox={VB} overflow="visible" aria-hidden="true">
      <Planks c={c} />
      <Slabs c={c} />
      <SunRays />
    </svg>
  );
}

const PLANKS_PER_TILE = 2;
const SEAM_PATTERN = [0.3, 0.7, 0.5, 0.15, 0.85, 0.45, 0.65, 0.25];

function Planks({ c }: { c: LobbyColors }) {
  const n = TILES * PLANKS_PER_TILE;
  const w = { dx: COL.dx / PLANKS_PER_TILE, dy: COL.dy / PLANKS_PER_TILE };
  const len = { dx: ROW.dx * TILES, dy: ROW.dy * TILES };
  const boards = [];
  const seams = [];
  for (let i = 0; i < n; i++) {
    const p0 = { x: FLOOR_BACK.x + i * w.dx, y: FLOOR_BACK.y + i * w.dy };
    boards.push(<path key={`b${i}`} d={`M${p0.x} ${p0.y} l${len.dx} ${len.dy} l${w.dx} ${w.dy} l${-len.dx} ${-len.dy} Z`} fill={plankTone(c, i)} stroke={c.floorSeam} strokeWidth="0.6" />);
    for (const s of plankSeams(i)) {
      const sx = p0.x + len.dx * s;
      const sy = p0.y + len.dy * s;
      seams.push(<line key={`s${i}-${s}`} x1={sx} y1={sy} x2={sx + w.dx} y2={sy + w.dy} stroke={c.floorSeam} strokeWidth="0.7" />);
    }
  }
  return (
    <g>
      {boards}
      {seams}
    </g>
  );
}

function Slabs({ c }: { c: LobbyColors }) {
  const slabs = [];
  const n = TILES * PLANKS_PER_TILE;
  const w = { dx: COL.dx / PLANKS_PER_TILE, dy: COL.dy / PLANKS_PER_TILE };
  for (let i = 0; i < n; i++) {
    const x0 = i === 0 ? OUTER_LEFT.x : FLOOR_LEFT.x + i * w.dx;
    const y0 = i === 0 ? OUTER_LEFT.y : FLOOR_LEFT.y + i * w.dy;
    const x1 = FLOOR_LEFT.x + (i + 1) * w.dx;
    const y1 = FLOOR_LEFT.y + (i + 1) * w.dy;
    slabs.push(<path key={`pl-${i}`} d={`M${x0} ${y0} L${x1} ${y1} L${x1} ${y1 + SLAB_H} L${x0} ${y0 + SLAB_H} Z`} fill={plankSide(c, i, "left")} stroke={c.floorSeam} strokeWidth="0.6" />);
  }
  const last = n - 1;
  const stops = [0, ...plankSeams(last).sort((a, b) => a - b), 1];
  for (let k = 0; k < stops.length - 1; k++) {
    const sA = stops[k],
      sB = stops[k + 1];
    const xa = k === 0 ? OUTER_RIGHT.x : FLOOR_RIGHT.x + ROW.dx * TILES * sA;
    const ya = k === 0 ? OUTER_RIGHT.y : FLOOR_RIGHT.y + ROW.dy * TILES * sA;
    const xb = FLOOR_RIGHT.x + ROW.dx * TILES * sB;
    const yb = FLOOR_RIGHT.y + ROW.dy * TILES * sB;
    slabs.push(<path key={`pr-${k}`} d={`M${xa} ${ya} L${xb} ${yb} L${xb} ${yb + SLAB_H} L${xa} ${ya + SLAB_H} Z`} fill={plankSide(c, last, "right")} stroke={c.floorSeam} strokeWidth="0.6" />);
  }
  return <g>{slabs}</g>;
}

function plankTone(c: LobbyColors, i: number): string {
  const tones = [c.floorA, c.floorB, c.floorC, c.floorA, c.floorB];
  return tones[i % tones.length];
}

function plankSeams(i: number): number[] {
  const s1 = SEAM_PATTERN[i % SEAM_PATTERN.length];
  return [s1, (s1 + 0.5) % 1];
}

function plankSide(c: LobbyColors, i: number, side: "left" | "right"): string {
  return shade(plankTone(c, i), side === "left" ? 0.8 : 0.66);
}

export const PROP_SCALE = 1.5;
function placementDepth(p: Placement): number {
  return p.a + p.b + (p.z ?? 0);
}

export function LobbyProps({
  placements,
  variants,
  rooms,
  officeName,
  mode,
  star,
  receptionist,
}: {
  placements: Placement[];
  variants?: Record<string, string>;
  rooms: LobbyRoomRef[];
  officeName: string;
  mode: ThemeMode;
  star: PropStar | null;
  receptionist?: { a: number; b: number; node: ReactNode };
}) {
  const resolved = placements
    .map((p) => {
      const variantId = variants?.[p.family] ?? p.variant;
      const v = findVariant(p.family, variantId) ?? findVariant(p.family, p.variant);
      return v ? { p, v } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const walls = resolved.filter(({ v }) => v.wall);
  const rugs = resolved.filter(({ p, v }) => !v.wall && p.family === "rug");
  const floor = resolved.filter(({ p, v }) => !v.wall && p.family !== "rug").sort((x, y) => placementDepth(x.p) - placementDepth(y.p));
  return (
    <svg style={SVG_STYLE} width={SCENE_W} height={SCENE_H} viewBox={VB} overflow="visible" aria-hidden="true">
      <ShadowDefs dark={mode === "dark"} />
      <PropDefs />
      <defs>
        <radialGradient id="lobby-fire-glow">
          <stop offset="0" stopColor="#ff9a3c" stopOpacity="0.30" />
          <stop offset="0.5" stopColor="#ff8a2a" stopOpacity="0.10" />
          <stop offset="1" stopColor="#ff8a2a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="lobby-lamp-pool">
          <stop offset="0" stopColor="#ffe9a8" stopOpacity="0.32" />
          <stop offset="0.55" stopColor="#ffe9a8" stopOpacity="0.10" />
          <stop offset="1" stopColor="#ffe9a8" stopOpacity="0" />
        </radialGradient>
      </defs>
      {walls.map(({ p, v }, i) => {
        const C = v.Component;
        const wall = p.wall ?? "left";
        const { x, y } = wall === "left" ? floorXY(p.b, 0) : floorXY(0, p.a);
        return (
          <g key={`w${i}`} transform={`translate(${x} ${y - (p.h ?? 60)}) scale(${PROP_SCALE * (p.scale ?? 1)})`}>
            <C rooms={rooms} officeName={officeName} wall={wall} star={star} back="far" />
          </g>
        );
      })}
      {floor
        .filter(({ p }) => p.family === "fireplace")
        .map(({ p }, i) => {
          const { x, y } = floorXY(p.b, p.a);
          return (
            <g key={`fg${i}`} className="lobby-dark-only" aria-hidden="true">
              <ellipse cx={x} cy={y - 60} rx={150} ry={120} fill="url(#lobby-fire-glow)" />
              <ellipse cx={x - 40} cy={y + 24} rx={110} ry={55} fill="url(#lobby-fire-glow)" opacity="0.8" />
            </g>
          );
        })}
      {rugs.map(({ p, v }, i) => {
        const C = v.Component;
        const { x, y } = floorXY(p.b, p.a);
        const s = PROP_SCALE * (p.scale ?? 1);
        return (
          <g key={`r${i}`} transform={`translate(${x} ${y}) scale(${s})`}>
            <C rooms={rooms} officeName={officeName} wall="left" star={star} back="far" />
          </g>
        );
      })}
      {floor
        .filter(({ p }) => p.family === "lamp")
        .map(({ p }, i) => {
          const { x, y } = floorXY(p.b, p.a);
          return <ellipse key={`lp${i}`} className="lamp-glow" cx={x - (p.variant === "arc" ? 55 : 0)} cy={y + 6} rx={96} ry={48} fill="url(#lobby-lamp-pool)" aria-hidden="true" />;
        })}
      {[
        ...floor.map(({ p, v }, i) => {
          const C = v.Component;
          const { x, y } = floorXY(p.b, p.a);
          const facing = p.facing;
          const facings = variantFacings(v);
          const mirrored = facing === "SW" || facing === "NW" || (!facing && p.flip);
          const flip = mirrored && facings > 1;
          const back = facings === 4 && (facing === "NE" || facing === "NW") ? "near" : "far";
          const s = PROP_SCALE * (p.scale ?? 1);
          return {
            depth: placementDepth(p),
            node: (
              <g key={`f${i}`} transform={`translate(${x} ${y}) scale(${flip ? -s : s} ${s})`}>
                {v.shadow && <ContactShadow rx={v.shadow.rx} ry={v.shadow.ry} />}
                <C rooms={rooms} officeName={officeName} wall="left" star={star} back={back} />
              </g>
            ),
          };
        }),
        ...(receptionist
          ? [
              {
                depth: receptionist.a + receptionist.b,
                node: (
                  <g key="receptionist" transform={`translate(${floorXY(receptionist.b, receptionist.a).x} ${floorXY(receptionist.b, receptionist.a).y})`}>
                    <ContactShadow rx={14} ry={7} />
                    {receptionist.node}
                  </g>
                ),
              },
            ]
          : []),
      ]
        .sort((x, y) => x.depth - y.depth)
        .map((item) => item.node)}
    </svg>
  );
}

export { wallTransform };
