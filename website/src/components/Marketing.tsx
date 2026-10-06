import { github } from '../brand-icons.ts';
import { SITE } from '../site.ts';
import { Logo } from './Logo.tsx';
import { OfficeScene, STATUS_COLOR, type Status } from './OfficeScene.tsx';

export function Header() {
  return (
    <header className="site-header">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <a className="brand" href="#top" aria-label="bureau home">
        <img src="/favicon.svg" alt="" width={22} height={22} />
        <span>
          bureau<span className="brand-dot" aria-hidden="true">.</span>
        </span>
      </a>
      <nav aria-label="Primary">
        <a href="#how">How it works</a>
        <a href="#features">Features</a>
        <a href="#faq">FAQ</a>
        <a className="nav-github" href={SITE.github} target="_blank" rel="noreferrer">
          <Logo icon={github} />
          GitHub
        </a>
      </nav>
    </header>
  );
}

const LEGEND: [Status, string][] = [
  ['working', 'Working'],
  ['waiting', 'Needs you'],
  ['sleeping', 'Sleeping'],
];

export function Hero() {
  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      <div className="hero-copy">
        <p className="eyebrow">Your agent office. Cute in a useful way.</p>
        <h1 id="hero-title">
          Four agents.
          <br />
          <em>One office.</em>
          <br />
          <em>One glance.</em>
        </h1>
        <p className="hero-desc">
          Every Claude Code, Codex, and OpenCode agent gets a desk. See who's working, who's waiting,
          and who needs you — <span className="marker">from any device.</span>
        </p>
        <div className="hero-actions">
          <a className="btn btn-primary" href={SITE.quickStart}>
            Open your office <span aria-hidden="true">→</span>
          </a>
          <a className="btn btn-ghost" href="#how">
            See how it works
          </a>
        </div>
        <p className="fine">Free · self-hosted · runs on your Claude subscription</p>
      </div>
      <figure className="office-card">
        <div className="window-bar" aria-hidden="true">
          <span />
          <span />
          <span />
          <small>localhost:4000</small>
        </div>
        <OfficeScene />
        <figcaption className="legend">
          {LEGEND.map(([status, label]) => (
            <span key={status}>
              <i style={{ background: STATUS_COLOR[status] }} aria-hidden="true" />
              {label}
            </span>
          ))}
        </figcaption>
      </figure>
    </section>
  );
}

const STEPS = [
  {
    title: 'Open the office',
    body: 'Clone the repo and run one command. Bureau is a single Bun process — no database, no cloud account, no API key.',
    code: 'bun run dev',
  },
  {
    title: 'Click an empty desk',
    body: 'Pick an engine (Claude, Codex, or OpenCode), a model, an effort level, or start from one of a dozen agent templates.',
    code: 'localhost:4000',
  },
  {
    title: 'Check in from anywhere',
    body: 'Status lights show who is busy, idle, or waiting on you. Type while an agent works and your message queues until it is free.',
    code: 'phone · laptop · Tailscale',
  },
];

export function HowItWorks() {
  return (
    <section className="section" id="how" aria-labelledby="how-title">
      <p className="eyebrow">How it works</p>
      <h2 id="how-title">
        From one terminal to <em>a whole team.</em>
      </h2>
      <ol className="steps">
        {STEPS.map((step, i) => (
          <li key={step.title}>
            <span className="step-num">{String(i + 1).padStart(2, '0')}</span>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
            <code>{step.code}</code>
          </li>
        ))}
      </ol>
    </section>
  );
}
