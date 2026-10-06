import * as icons from '../brand-icons.ts';
import type { BrandIcon } from '../brand-icons.ts';
import { SITE } from '../site.ts';
import { Logo } from './Logo.tsx';

const COLUMNS: { title: string; links: [string, string][] }[] = [
  {
    title: 'Product',
    links: [
      ['How it works', '#how'],
      ['Features', '#features'],
      ['FAQ', '#faq'],
      ['Quick start', SITE.quickStart],
    ],
  },
  {
    title: 'Resources',
    links: [
      ['Documentation', SITE.docs],
      ['How it’s built', SITE.article],
      ['Hosting options', SITE.hosting],
      ['Access & invites', SITE.access],
    ],
  },
  {
    title: 'Project',
    links: [
      ['Contributing', SITE.contributing],
      ['Report an issue', SITE.issues],
      ['Security', SITE.security],
      ['License', SITE.license],
    ],
  },
];

const WORKS_WITH: { label: string; icon?: BrandIcon }[] = [
  { label: 'Claude Code', icon: icons.claude },
  { label: 'Codex' },
  { label: 'OpenCode', icon: icons.opencode },
  { label: 'Tailscale', icon: icons.tailscale },
  { label: 'Bun', icon: icons.bun },
];

export function Cta() {
  return (
    <section className="cta" aria-labelledby="cta-title">
        <h2 id="cta-title">
          Punch in. <em>Pull up a desk.</em>
        </h2>
        <pre>
          <code>{'git clone https://github.com/smeltery/bureau.git\ncd bureau && bun install && bun run dev'}</code>
        </pre>
        <a className="btn btn-primary" href={SITE.quickStart}>
          Read the quick start <span aria-hidden="true">→</span>
        </a>
    </section>
  );
}

export function Footer() {
  return (
      <footer className="site-footer">
        <div className="footer-grid">
          <div className="footer-brand">
            <a className="brand" href="#top" aria-label="bureau home">
              <img src="/favicon.svg" alt="" width={22} height={22} />
              <span>
                bureau<span className="brand-dot" aria-hidden="true">.</span>
              </span>
            </a>
            <p>A self-hosted office where every AI coding agent gets a desk.</p>
            <a className="btn btn-ghost btn-small" href={SITE.github}>
              <Logo icon={icons.github} />
              Star on GitHub
            </a>
          </div>
          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h3>{col.title}</h3>
              <ul>
                {col.links.map(([label, href]) => (
                  <li key={label}>
                    <a href={href}>{label}</a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="works-with">
          <span>Works with</span>
          <ul>
            {WORKS_WITH.map(({ label, icon }) => (
              <li key={label}>
                {icon && <Logo icon={icon} />}
                {label}
              </li>
            ))}
          </ul>
        </div>
        <div className="footer-bottom">
          <p>
            © 2026 <a href={SITE.smeltery}>smeltery</a>. Source-available under the{' '}
            <a href={SITE.license}>PolyForm Shield 1.0.0</a> license.
            <span className="footer-sep" aria-hidden="true">
              ·
            </span>
            Product names and logos are trademarks of their respective owners.
          </p>
          <a className="footer-social" href={SITE.github} aria-label="bureau on GitHub">
            <Logo icon={icons.github} size={18} />
          </a>
        </div>
      </footer>
  );
}
