// The bureau mark: an isometric office floor with four desks and status
// lights. Drawn on a 64×64 grid. The detailed cut is for 48 px and up; the
// simple cut drops props and agents and enlarges the lights so it survives
// favicon sizes. Single-quoted attributes only — the app inlines the simple
// cut as a data-URI favicon inside a double-quoted href.

type Pt = [number, number];
type Status = 'working' | 'waiting' | 'sleeping';

const C = {
  floor: '#3AC874',
  tile: '#33b267',
  sideL: '#1d7d48',
  sideR: '#145c35',
  wallL: '#d9efe1',
  wallR: '#c4e3cf',
  trim: '#209050',
  ring: '#145c35',
  monitor: '#242522',
  desk: ['#e2c29b', '#c49a6c', '#a97f55'],
  pot: ['#8a6a4a', '#75583c', '#664b33'],
  status: { working: '#2fd27a', waiting: '#f2a922', sleeping: '#7d8a82' } as Record<Status, string>,
};

const DESKS: { u: number; v: number; status: Status; shirt: string }[] = [
  { u: 0.1, v: 0.12, status: 'working', shirt: '#3b6fb6' },
  { u: 0.62, v: 0.1, status: 'waiting', shirt: '#c05a4a' },
  { u: 0.1, v: 0.6, status: 'sleeping', shirt: '#8a5fb0' },
  { u: 0.6, v: 0.6, status: 'working', shirt: '#e0864a' },
];

const WALL = 22;

const p = (u: number, v: number, z = 0): Pt => [32 + (u - v) * 28, 26 + (u + v) * 14 - z];
const n = (x: number) => Number(x.toFixed(2));
const pts = (...ps: Pt[]) => ps.map(([x, y]) => `${n(x)},${n(y)}`).join(' ');
const poly = (fill: string, ...ps: Pt[]) => `<polygon points='${pts(...ps)}' fill='${fill}'/>`;
const line = (a: Pt, b: Pt, stroke: string, width: number) =>
  `<line x1='${n(a[0])}' y1='${n(a[1])}' x2='${n(b[0])}' y2='${n(b[1])}' stroke='${stroke}' stroke-width='${width}'/>`;

function box(u: number, v: number, du: number, dv: number, h: number, [top, left, right]: string[]): string {
  const T = (a: number, b: number) => p(a, b, h);
  return (
    poly(right, T(u + du, v), T(u + du, v + dv), p(u + du, v + dv), p(u + du, v)) +
    poly(left, T(u, v + dv), T(u + du, v + dv), p(u + du, v + dv), p(u, v + dv)) +
    poly(top, T(u, v), T(u + du, v), T(u + du, v + dv), T(u, v + dv))
  );
}

function walls(detailed: boolean): string {
  let s = poly(C.wallL, p(0, 1), p(0, 0), p(0, 0, WALL), p(0, 1, WALL));
  s += poly(C.wallR, p(0, 0), p(1, 0), p(1, 0, WALL), p(0, 0, WALL));
  s += `<polyline points='${pts(p(0, 1, WALL), p(0, 0, WALL), p(1, 0, WALL))}' fill='none' stroke='${C.trim}' stroke-width='1.6' stroke-linejoin='round'/>`;
  if (!detailed) return s;
  s += poly('#9fd3e6', p(0, 0.2, 8), p(0, 0.48, 8), p(0, 0.48, 17), p(0, 0.2, 17));
  s += line(p(0, 0.34, 8), p(0, 0.34, 17), '#ffffff', 0.8);
  s += poly('#c49a6c', p(0.3, 0, 8), p(0.56, 0, 8), p(0.56, 0, 16.5), p(0.3, 0, 16.5));
  s += poly('#fff4c2', p(0.34, 0, 11), p(0.41, 0, 11), p(0.41, 0, 15), p(0.34, 0, 15));
  s += poly('#ffffff', p(0.45, 0, 9.5), p(0.52, 0, 9.5), p(0.52, 0, 13.5), p(0.45, 0, 13.5));
  const [cx, cy] = p(0.9, 0, 15);
  s += `<ellipse cx='${n(cx)}' cy='${n(cy)}' rx='1.9' ry='2.2' fill='#ffffff' stroke='${C.trim}' stroke-width='0.7'/>`;
  s += `<path d='M${n(cx)} ${n(cy)} v-1.4 M${n(cx)} ${n(cy)} l1 0.5' stroke='${C.monitor}' stroke-width='0.45' stroke-linecap='round'/>`;
  return s;
}

function floor(detailed: boolean): string {
  let s = poly(C.sideL, p(0, 1), p(1, 1), p(1, 1, -4), p(0, 1, -4));
  s += poly(C.sideR, p(1, 0), p(1, 1), p(1, 1, -4), p(1, 0, -4));
  s += poly(C.floor, p(0, 0), p(1, 0), p(1, 1), p(0, 1));
  if (!detailed) return s;
  for (const k of [0.25, 0.5, 0.75]) {
    s += line(p(k, 0), p(k, 1), C.tile, 0.6);
    s += line(p(0, k), p(1, k), C.tile, 0.6);
  }
  return s;
}

function desk(d: (typeof DESKS)[number], detailed: boolean): string {
  const [hx, hy] = p(d.u + 0.1, d.v - 0.02);
  let s = '';
  if (detailed) {
    s += `<rect x='${n(hx - 2.3)}' y='${n(hy - 7.4)}' width='4.6' height='5.4' rx='2' fill='${d.shirt}'/>`;
    s += `<circle cx='${n(hx)}' cy='${n(hy - 9)}' r='2.1' fill='#f0c9a4'/>`;
  }
  s += box(d.u, d.v, 0.24, 0.14, 4, C.desk);
  if (detailed) {
    const m = (a: number, z: number) => p(d.u + a, d.v + 0.05, z);
    s += poly(C.monitor, m(0.08, 4), m(0.17, 4), m(0.17, 7.5), m(0.08, 7.5));
  }
  const lift = detailed ? 13.6 : 8;
  const r = detailed ? 1.7 : 3.4;
  const ring = detailed ? 0.8 : 1.3;
  s += `<circle cx='${n(hx)}' cy='${n(hy - lift)}' r='${r}' fill='${C.status[d.status]}' stroke='${C.ring}' stroke-width='${ring}'/>`;
  return s;
}

function plant(): string {
  const [px, py] = p(0.08, 0.9, 3);
  return (
    box(0.04, 0.86, 0.08, 0.08, 3, C.pot) +
    `<circle cx='${n(px - 1.4)}' cy='${n(py - 2)}' r='2.2' fill='#2f8a4f'/>` +
    `<circle cx='${n(px + 1.4)}' cy='${n(py - 3.4)}' r='2.4' fill='#246f3f'/>`
  );
}

/** Inner SVG markup of the mark on a 64×64 grid. */
export function officeMark(detailed: boolean): string {
  return walls(detailed) + floor(detailed) + DESKS.map((d) => desk(d, detailed)).join('') + (detailed ? plant() : '');
}

/** Standalone SVG document. The simple cut is framed on a 32×32 viewBox for favicon consumers. */
export function officeMarkSvg(detailed: boolean): string {
  return detailed
    ? `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>${officeMark(true)}</svg>`
    : `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><g transform='scale(0.5)'>${officeMark(false)}</g></svg>`;
}

/** Maskable app icon: the detailed mark inside the 80% safe zone of a dark plate. */
export function maskableIconSvg(plate = '#181a20'): string {
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' fill='${plate}'/><g transform='translate(13.2 14.35) scale(1.15)'>${officeMark(true)}</g></svg>`;
}
