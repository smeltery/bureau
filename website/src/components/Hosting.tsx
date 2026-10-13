import { SITE } from '../site.ts';

const OPTIONS = [
  {
    number: '01',
    title: 'On your computer',
    label: 'A local start',
    body: 'Run Bureau where your projects already live. Open the office in your browser and connect your model account.',
    note: 'Your computer needs to stay awake while agents work.',
    link: SITE.localHosting,
    action: 'Local setup guide',
  },
  {
    number: '02',
    title: 'Across your devices',
    label: 'A private office',
    body: 'Keep Bureau on an always-on machine and connect from your laptop or phone through a private Tailscale network.',
    note: 'Each connecting device needs access to your tailnet.',
    link: SITE.privateHosting,
    action: 'Private access guide',
  },
  {
    number: '03',
    title: 'At your own address',
    label: 'A shared destination',
    body: 'Put your office behind a custom HTTPS domain and invite collaborators. Configure wildcard DNS for agent-built app hostnames.',
    note: 'You manage the host, domain, HTTPS, and office access.',
    link: SITE.domainHosting,
    action: 'Custom domain guide',
  },
];

export function Hosting() {
  return (
    <section className="section" id="hosting" aria-labelledby="hosting-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Choose your setup</p>
          <h2 id="hosting-title">
            Your office can be <em>where you need it.</em>
          </h2>
        </div>
        <p>
          Start on one machine or make room for remote access. Each guide walks through setup,
          account connection, and access.
        </p>
      </div>
      <div className="hosting-options">
        {OPTIONS.map((option) => (
          <article className="hosting-option" key={option.title}>
            <div className="hosting-label">
              <span>{option.label}</span>
              <span aria-hidden="true">{option.number}</span>
            </div>
            <h3>{option.title}</h3>
            <p>{option.body}</p>
            <p className="hosting-note">{option.note}</p>
            <a href={option.link}>
              {option.action} <span aria-hidden="true">→</span>
            </a>
          </article>
        ))}
      </div>
      <div className="hosting-footnote">
        <p>Looking for Funnel, a fresh VPS, Render, or Kubernetes?</p>
        <a href={SITE.hosting}>
          See every hosting path <span aria-hidden="true">→</span>
        </a>
      </div>
    </section>
  );
}
