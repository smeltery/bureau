// biome-ignore-all lint/a11y/noNoninteractiveTabindex: The overflow region must be keyboard-scrollable on narrow screens.
import { useId } from 'react';
import './diagram.css';

const flows = {
  message: {
    actors: ['Your script', 'Bureau', 'Agent'],
    steps: [
      [0, 1, 'POST /api/agents/{id}/messages'],
      [1, 0, '200 · messageId'],
      [1, 1, 'Queue while the agent is busy'],
      [1, 2, 'Deliver when idle'],
      [2, 1, 'Reply to your token'],
      [0, 1, 'POST /api/me/api-token-inbox/drain'],
      [1, 0, 'entries + latestSequence'],
    ],
    caption: 'Sending returns immediately. Replies land in your token’s inbox, which you drain on your own schedule.',
  },
  webhook: {
    actors: ['GitHub', 'Bureau', 'Agent or schedule'],
    steps: [
      [0, 1, 'POST /hooks/github/{id} · signed'],
      [1, 1, 'Verify signature, event, and action'],
      [1, 0, '202 · accepted'],
      [1, 2, 'Selected payload fields'],
    ],
    caption: 'GitHub signs each delivery with the webhook secret. Bureau forwards only the fields you selected.',
  },
} as const;

export function SequenceDiagram({ kind }: { kind: keyof typeof flows }) {
  const id = useId().replaceAll(':', '');
  const flow = flows[kind];
  const height = 125 + flow.steps.length * 58;
  return (
    <figure className="sequence-figure">
      <section className="sequence-scroll" tabIndex={0} aria-label="Scrollable sequence diagram">
        <svg viewBox={`0 0 720 ${height}`} role="img" aria-labelledby={`${id}-title ${id}-desc`}>
          <title id={`${id}-title`}>{kind === 'webhook' ? 'Inbound webhook' : 'Scripted message'} sequence</title>
          <desc id={`${id}-desc`}>{flow.steps.map(([from, to, label]) => `${flow.actors[from]} to ${flow.actors[to]}: ${label}`).join('. ')}</desc>
          <defs>
            <marker id={`${id}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0 10 5 0 10Z" fill="#789166" />
            </marker>
          </defs>
          {flow.actors.map((actor, index) => (
            <g key={actor}>
              <rect x={40 + index * 240} y="15" width="160" height="45" rx="7" fill="#eef3e6" stroke="#b4c4a3" />
              <text x={120 + index * 240} y="43" textAnchor="middle">
                {actor}
              </text>
              <line x1={120 + index * 240} x2={120 + index * 240} y1="60" y2={height - 20} stroke="#c5cfbc" strokeDasharray="4 5" />
            </g>
          ))}
          {flow.steps.map(([from, to, label], index) => {
            const x1 = 120 + from * 240,
              x2 = 120 + to * 240,
              y = 108 + index * 58;
            return (
              <g key={label}>
                <text x={from === to ? x1 + 10 : (x1 + x2) / 2} y={y - 10} textAnchor={from === to ? 'start' : 'middle'}>
                  {label}
                </text>
                <path d={from === to ? `M${x1} ${y}h130v18h-130` : `M${x1} ${y}H${x2}`} fill="none" stroke="#789166" strokeDasharray={to < from ? '5 4' : undefined} markerEnd={`url(#${id}-arrow)`} />
              </g>
            );
          })}
        </svg>
      </section>
      <figcaption>{flow.caption}</figcaption>
    </figure>
  );
}
