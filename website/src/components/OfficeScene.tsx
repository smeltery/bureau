// Presentation attributes only (no stylesheet dependencies), so the same art
// renders in the page and in the standalone OG image.

export type Status = 'working' | 'waiting' | 'sleeping';

type Desk = { name: string; status: Status; u: number; v: number; shirt: string; hair: string };

export const STATUS_COLOR: Record<Status, string> = {
  working: '#2f9e5b',
  waiting: '#d99a26',
  sleeping: '#a3a39b',
};

const DESKS: Desk[] = [
  { name: 'Ada', status: 'working', u: 0.1, v: 0.1, shirt: '#3b6fb6', hair: '#3a2a20' },
  { name: 'Grace', status: 'waiting', u: 0.62, v: 0.15, shirt: '#c05a4a', hair: '#1f1a17' },
  { name: 'Linus', status: 'sleeping', u: 0.15, v: 0.62, shirt: '#6f8f4e', hair: '#b07a3c' },
  { name: 'Margaret', status: 'working', u: 0.66, v: 0.66, shirt: '#8a5fb0', hair: '#5a3a28' },
];

const FONT = "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', Helvetica, Arial, sans-serif";
const INK = '#242522';
const LINE = '#d9d8cf';

type Pt = [number, number];
const iso = (u: number, v: number, z = 0): Pt => [280 + (u - v) * 240, 140 + (u + v) * 120 - z];
const pts = (...p: Pt[]) => p.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

function Box({ u, v, du, dv, h, z = 0, fill }: { u: number; v: number; du: number; dv: number; h: number; z?: number; fill: [string, string, string] }) {
  const top = (a: number, b: number) => iso(a, b, z + h);
  const low = (a: number, b: number) => iso(a, b, z);
  return (
    <g>
      <polygon points={pts(top(u + du, v), top(u + du, v + dv), low(u + du, v + dv), low(u + du, v))} fill={fill[2]} />
      <polygon points={pts(top(u, v + dv), top(u + du, v + dv), low(u + du, v + dv), low(u, v + dv))} fill={fill[1]} />
      <polygon points={pts(top(u, v), top(u + du, v), top(u + du, v + dv), top(u, v + dv))} fill={fill[0]} />
    </g>
  );
}

function Agent({ desk }: { desk: Desk }) {
  const [x, y] = iso(desk.u + 0.07, desk.v - 0.03);
  const asleep = desk.status === 'sleeping';
  const tagW = desk.name.length * 7.4 + 30;
  return (
    <g>
      <rect x={x - 12} y={y - 44} width={24} height={30} rx={10} fill={desk.shirt} />
      <circle cx={x} cy={y - 52} r={10} fill="#f0c9a4" />
      <path d={`M${x - 10} ${y - 53} a10 10 0 0 1 20 0 q-10 -5 -20 0z`} fill={desk.hair} />
      {asleep ? (
        <path d={`M${x - 5} ${y - 50} h3 M${x + 2} ${y - 50} h3`} stroke={INK} strokeWidth={1.4} strokeLinecap="round" />
      ) : (
        <>
          <circle cx={x - 3.5} cy={y - 50} r={1.3} fill={INK} />
          <circle cx={x + 3.5} cy={y - 50} r={1.3} fill={INK} />
        </>
      )}
      <Box u={desk.u} v={desk.v} du={0.18} dv={0.1} h={20} fill={['#d6b48c', '#b8916a', '#a37c57']} />
      <polygon points={pts(iso(desk.u + 0.06, desk.v + 0.04, 20), iso(desk.u + 0.13, desk.v + 0.04, 20), iso(desk.u + 0.13, desk.v + 0.04, 36), iso(desk.u + 0.06, desk.v + 0.04, 36))} fill="#4a4c47" />
      <g transform={`translate(${x - tagW / 2} ${y - 92})`}>
        <rect width={tagW} height={20} rx={10} fill="#ffffff" stroke={LINE} />
        <circle cx={12} cy={10} r={4.5} fill={STATUS_COLOR[desk.status]} className={`status-dot status-${desk.status}`} />
        <text x={22} y={14} fontFamily={FONT} fontSize={11.5} fontWeight={600} fill={INK}>
          {desk.name}
        </text>
      </g>
      {asleep && (
        <text x={x + 14} y={y - 62} fontFamily={FONT} fontSize={11} fontWeight={700} fill="#8d8f88">
          z z
        </text>
      )}
      {desk.status === 'waiting' && (
        <g transform={`translate(${x + 21} ${y - 58})`}>
          <circle r={9} fill={STATUS_COLOR.waiting} />
          <text y={4} textAnchor="middle" fontFamily={FONT} fontSize={12} fontWeight={800} fill="#ffffff">
            !
          </text>
        </g>
      )}
    </g>
  );
}

export function OfficeArt() {
  const grid = [1, 2, 3, 4, 5];
  return (
    <g>
      <polygon points={pts(iso(0, 1), iso(0, 0), iso(0, 0, 120), iso(0, 1, 120))} fill="#e9e8e0" />
      <polygon points={pts(iso(0, 0), iso(1, 0), iso(1, 0, 120), iso(0, 0, 120))} fill="#e1e0d7" />
      <polygon points={pts(iso(0, 0.22, 52), iso(0, 0.5, 52), iso(0, 0.5, 98), iso(0, 0.22, 98))} fill="#cfe0e6" stroke="#ffffff" strokeWidth={3} />
      <polygon points={pts(iso(0.3, 0, 46), iso(0.56, 0, 46), iso(0.56, 0, 92), iso(0.3, 0, 92))} fill="#c49a6c" />
      <polygon points={pts(iso(0.34, 0, 62), iso(0.41, 0, 62), iso(0.41, 0, 84), iso(0.34, 0, 84))} fill="#fff7d6" />
      <polygon points={pts(iso(0.45, 0, 54), iso(0.52, 0, 54), iso(0.52, 0, 76), iso(0.45, 0, 76))} fill="#e3f1e8" />
      <ellipse cx={iso(0.8, 0, 88)[0]} cy={iso(0.8, 0, 88)[1]} rx={11} ry={14} fill="#ffffff" stroke="#b9b8ae" strokeWidth={2} />
      <polygon points={pts(iso(0, 0), iso(1, 0), iso(1, 1), iso(0, 1))} fill="#f3f2ec" stroke={LINE} />
      {grid.map((k) => (
        <g key={k} stroke="#e6e5dd">
          <line x1={iso(k / 6, 0)[0]} y1={iso(k / 6, 0)[1]} x2={iso(k / 6, 1)[0]} y2={iso(k / 6, 1)[1]} />
          <line x1={iso(0, k / 6)[0]} y1={iso(0, k / 6)[1]} x2={iso(1, k / 6)[0]} y2={iso(1, k / 6)[1]} />
        </g>
      ))}
      {DESKS.map((desk) => (
        <Agent key={desk.name} desk={desk} />
      ))}
      <Box u={0.04} v={0.86} du={0.06} dv={0.06} h={18} fill={['#8a6a4a', '#75583c', '#664b33']} />
      <circle cx={iso(0.07, 0.89, 34)[0] - 6} cy={iso(0.07, 0.89, 34)[1]} r={9} fill="#5f9b62" />
      <circle cx={iso(0.07, 0.89, 34)[0] + 6} cy={iso(0.07, 0.89, 40)[1]} r={10} fill="#4f8a55" />
      <ellipse cx={iso(0.92, 0.35)[0]} cy={iso(0.92, 0.35)[1]} rx={22} ry={10} fill="#d7b28b" />
      <ellipse cx={iso(0.92, 0.35, 6)[0]} cy={iso(0.92, 0.35, 6)[1]} rx={13} ry={7} fill="#e39a4f" />
    </g>
  );
}

export function OfficeScene() {
  return (
    <svg className="office-scene" viewBox="20 10 520 380" role="img" aria-labelledby="office-scene-title">
      <title id="office-scene-title">
        An isometric office: Ada and Margaret are working, Grace is waiting for you, Linus is asleep at his desk.
      </title>
      <OfficeArt />
    </svg>
  );
}
