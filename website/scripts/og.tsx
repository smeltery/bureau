// Regenerates public/og.svg from the same office art the page uses.
// Run: bun scripts/og.tsx && npm run og
import { writeFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { OfficeArt } from '../src/components/OfficeScene.tsx';

const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const SERIF = 'Georgia, serif';
const INK = '#242522';
const MUTED = '#62655e';

function OgCard() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={1200} height={630} viewBox="0 0 1200 630">
      <rect width={1200} height={630} fill="#f6f6f3" />
      <g transform="translate(72 52)">
        <polygon points="0,9 13,16.5 13,27.5 0,20" fill="#209050" />
        <polygon points="26,9 13,16.5 13,27.5 26,20" fill="#186840" />
        <polygon points="13,2 26,9 13,16.5 0,9" fill="#3AC874" />
        <text x={38} y={23} fontFamily={SANS} fontSize={26} fontWeight={800} letterSpacing={-1} fill={INK}>
          bureau<tspan fill="#1f7a49">.</tspan>
        </text>
      </g>
      <text x={1128} y={76} textAnchor="end" fontFamily={SANS} fontSize={18} fill={MUTED}>
        Your agent office. Cute in a useful way.
      </text>

      <text fontFamily={SANS} fontSize={74} fontWeight={800} letterSpacing={-3.6} fill={INK}>
        <tspan x={72} y={232}>
          Four agents.
        </tspan>
      </text>
      <rect x={72} y={354} width={372} height={24} fill="rgba(58,200,116,0.28)" />
      <text fontFamily={SERIF} fontStyle="italic" fontSize={74} letterSpacing={-1.6} fill={INK}>
        <tspan x={72} y={306}>
          One office.
        </tspan>
        <tspan x={72} y={380}>
          One glance.
        </tspan>
      </text>
      <text fontFamily={SANS} fontSize={22} fill={MUTED}>
        <tspan x={72} y={440}>
          Every agent gets a desk. See who’s working,
        </tspan>
        <tspan x={72} y={470}>
          who’s waiting, and who needs you.
        </tspan>
      </text>
      <rect x={72} y={504} width={360} height={52} rx={26} fill={INK} />
      <text x={252} y={536} textAnchor="middle" fontFamily={SANS} fontSize={18} fontWeight={600} fill="#f6f6f3">
        Self-hosted · your Claude subscription
      </text>

      <rect x={628} y={118} width={510} height={446} rx={24} fill="#ffffff" stroke="#e1e2dc" strokeWidth={1.5} />
      <line x1={628} y1={160} x2={1138} y2={160} stroke="#e1e2dc" strokeWidth={1.5} />
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={654 + i * 18} cy={139} r={6} fill="#e1e2dc" />
      ))}
      <text x={720} y={144} fontFamily="Menlo, monospace" fontSize={14} fill={MUTED}>
        localhost:4000
      </text>
      <g transform="translate(633 160) scale(0.96)">
        <g transform="translate(-20 -10)">
          <OfficeArt />
        </g>
      </g>

      <text x={72} y={600} fontFamily={SANS} fontSize={16} fill={MUTED}>
        <tspan fill="#2f9e5b">●</tspan> No cloud. No account. Your machine.
      </text>
      <text x={1128} y={600} textAnchor="end" fontFamily={SANS} fontSize={16} fill={MUTED}>
        Claude · Codex · OpenCode
      </text>
    </svg>
  );
}

writeFileSync(
  new URL('../public/og.svg', import.meta.url),
  `<?xml version="1.0" encoding="UTF-8"?>\n${renderToStaticMarkup(<OgCard />)}\n`,
);
