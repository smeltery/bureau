import { SITE } from '../site.ts';

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

const FAQ_GROUPS = [
  {
    id: 'faq-using-bureau',
    title: 'Using Bureau',
    items: [
      {
        q: 'Which agents does Bureau run?',
        a: <p>Claude, Codex, and OpenCode. Choose the engine, model, and effort level for each agent — they all share one office.</p>,
      },
      {
        q: 'Do I need an API key?',
        a: <p>No. Claude agents can use your Claude Code login, and Codex agents can use your ChatGPT subscription. API keys are also supported. OpenCode credentials depend on the provider you choose.</p>,
      },
      {
        q: 'Can I check on agents from my phone?',
        a: <p>Yes. The interface supports touch and can be installed as a web app. Run Bureau on an always-on machine and connect over Tailscale from your phone. <a href={SITE.hosting}>Explore hosting options.</a></p>,
      },
      {
        q: 'How many agents can I run?',
        a: <p>Each room has eight desks, and you can add more rooms. Practical limits depend on your machine and model plan. The usage indicator shows available account limits when your provider reports them.</p>,
      },
      {
        q: 'What access do agents and teammates have?',
        a: <p>Agent access depends on the engine, permissions, and environment you configure. Safety hooks add checks for some destructive commands; they do not replace those controls. Teammate roles and room access determine what people can see and manage. <a href={SITE.access}>Read about access and invites.</a></p>,
      },
    ],
  },
  {
    id: 'faq-licensing',
    title: 'Licensing & costs',
    items: [
      {
        q: 'When can I use Bureau without a commercial license?',
        a: <>
          <p>The BSL Additional Use Grant permits production use for your own personal purposes, or for or on behalf of an organization with at most 10 people. Non-production use, including evaluation, development, and testing, is also permitted.</p>
          <p>You provide the hosting and model access; those may have their own costs. <a href={SITE.license}>Read the licensing guide.</a></p>
        </>,
      },
      {
        q: 'When do I need a commercial license?',
        a: <>
          <p>Other production use requires a commercial license from Isomux LLC, the licensor of the underlying BSL work. This includes internal production use by an organization with more than 10 people, even if it does not sell Bureau.</p>
          <p>For commercial licensing, contact <a href="mailto:llc@isomux.com">llc@isomux.com</a>. Bureau cannot grant exceptions to those terms. <a href={SITE.licenseText}>Read the full BSL license.</a></p>
        </>,
      },
      {
        q: 'Is Bureau open source or MIT-licensed?',
        a: <>
          <p>Bureau is source-available. The combined distribution is subject to the applicable Business Source License 1.1 terms, which are not an open-source license.</p>
          <p>Original contributions owned by smeltery are MIT-licensed, and historical MIT notices are preserved. Those grants do not make the entire distribution MIT-licensed or remove its BSL obligations. <a href={SITE.license}>See which terms apply.</a></p>
        </>,
      },
    ],
  },
];

export function Faq() {
  return (
    <section className="section faq-section" id="faq" aria-labelledby="faq-title">
      <div className="faq-intro">
        <p className="eyebrow">FAQ</p>
        <h2 id="faq-title">Questions, <em>answered.</em></h2>
        <p>Start with the essentials, from running your first agent to choosing the right license for your use.</p>
        <nav className="faq-topics" aria-label="FAQ topics">
          {FAQ_GROUPS.map((group) => <a key={group.id} href={`#${group.id}`}>{group.title} <span aria-hidden="true">↓</span></a>)}
        </nav>
        <p className="faq-help">Looking for setup instructions? <a href={SITE.quickStart}>Read the quick start →</a></p>
      </div>
      <div className="faq">
        {FAQ_GROUPS.map((group) => (
          <section className="faq-group" key={group.id} aria-labelledby={group.id}>
            <h3 id={group.id}>{group.title}</h3>
            {group.items.map((item) => (
              <details key={item.q}>
                <summary><span>{item.q}</span><span className="faq-toggle" aria-hidden="true" /></summary>
                <div className="faq-answer">{item.a}</div>
              </details>
            ))}
          </section>
        ))}
        <p className="faq-terms">Licensing answers summarize the current distribution. <a href={SITE.licenseText}>LICENSE</a> and <a href={SITE.notices}>NOTICE</a> contain the applicable terms and attribution.</p>
      </div>
    </section>
  );
}
