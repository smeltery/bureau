export function Local() {
  return (
    <section className="section local" aria-labelledby="local-title">
      <div>
        <p className="eyebrow">Self-hosted</p>
        <h2 id="local-title">
          Your machine. <em>Your subscription.</em>
        </h2>
      </div>
      <ul className="checklist">
        <li>Runs on your laptop, a Mac mini, or a Linux box — reach it from anywhere over Tailscale.</li>
        <li>Agents use your Claude Code login or ChatGPT subscription. No API key required.</li>
        <li>State lives in plain files under ~/.bureau, with daily backups. No database to run.</li>
        <li>Invite teammates with one-time links; sessions are cookie-gated end to end.</li>
      </ul>
    </section>
  );
}

const FAQ = [
  {
    q: 'Which agents does Bureau run?',
    a: 'Claude (Opus, Sonnet, Haiku, and Fable families), Codex (GPT-5.x), and OpenCode. Pick the engine, model, and effort level per agent — they all share one office.',
  },
  {
    q: 'Do I need an API key?',
    a: 'No. Claude agents use your Claude Code CLI login, and Codex agents can use your ChatGPT subscription. API keys work too if you prefer them.',
  },
  {
    q: 'Can I check on agents from my phone?',
    a: 'Yes. The UI is touch-optimised and installable as a PWA. Host Bureau on an always-on machine and open it over Tailscale from any device.',
  },
  {
    q: 'How many agents can I run?',
    a: 'Each room seats eight desks, and you can open more rooms. Your real limit is your machine and your plan allowance — the usage pill shows how much you have left.',
  },
  {
    q: 'Is it safe to let agents loose?',
    a: 'Agents run with your user’s permissions, so treat them like a capable colleague. Safety hooks block the classic destructive commands, and anyone you invite gets the same trust — invite carefully.',
  },
  {
    q: 'Is it free?',
    a: 'Personal use and production use for organizations with at most 10 people are permitted without a commercial license. Other production use requires a commercial license from the upstream licensor, Isomux LLC. Bureau is source-available; see the licensing terms linked below. You bring the machine and the model subscription.',
  },
];

export function Faq() {
  return (
    <section className="section" id="faq" aria-labelledby="faq-title">
      <p className="eyebrow">FAQ</p>
      <h2 id="faq-title">
        Questions, <em>answered.</em>
      </h2>
      <div className="faq">
        {FAQ.map((item) => (
          <details key={item.q}>
            <summary>{item.q}</summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
