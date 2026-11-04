import { useEffect, useRef } from 'react';
import { github } from '../brand-icons.ts';
import { SITE } from '../site.ts';
import { Logo } from './Logo.tsx';

const SECTION_CARDS = [
  { href: '#workflows', symbol: '◇', title: 'Workflows', detail: 'From a first prompt to the follow-through.' },
  { href: '#workspace', symbol: '✳', title: 'Workspace', detail: 'Review, steer, and hand off in one place.' },
  { href: '#hosting', symbol: '⌂', title: 'Hosting', detail: 'Your machine, your tailnet, or your domain.' },
  { href: '#faq', symbol: '?', title: 'FAQ', detail: 'Setup, licensing, and costs, answered.' },
];

const RESOURCES = [
  { href: SITE.apiDocs, title: 'API docs', detail: 'Script your office', external: false },
  { href: SITE.quickStart, title: 'Quick start', detail: 'Run it locally', external: true },
  { href: SITE.docs, title: 'Design docs', detail: 'How it works inside', external: true },
];

// Full-screen menu for narrow screens. A modal <dialog> provides the focus
// trap, Escape handling, and top-layer stacking above the sticky header.
export function MobileMenu() {
  const dialog = useRef<HTMLDialogElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const wide = matchMedia('(min-width: 861px)');
    const closeOnWide = () => wide.matches && dialog.current?.close();
    wide.addEventListener('change', closeOnWide);
    return () => wide.removeEventListener('change', closeOnWide);
  }, []);

  function open() {
    dialog.current?.showModal();
    toggle.current?.setAttribute('aria-expanded', 'true');
  }

  function close() {
    dialog.current?.close();
  }

  function onClose() {
    toggle.current?.setAttribute('aria-expanded', 'false');
    if (matchMedia('(max-width: 860px)').matches) toggle.current?.focus({ preventScroll: true });
  }

  return (
    <>
      <button className="menu-toggle" ref={toggle} type="button" aria-haspopup="dialog" aria-controls="mobile-menu" aria-expanded="false" onClick={open}>
        Menu
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <dialog className="mobile-menu" id="mobile-menu" ref={dialog} aria-labelledby="mobile-menu-title" onClose={onClose}>
        <div className="menu-header">
          <a className="brand" href="#top" aria-label="bureau home" onClick={close}>
            <img src="/favicon.svg" alt="" width={26} height={26} />
            <span>
              bureau
              <span className="brand-dot" aria-hidden="true">
                .
              </span>
            </span>
          </a>
          <button type="button" className="menu-close" aria-label="Close navigation" autoFocus onClick={close}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        <div className="menu-content">
          <p className="menu-eyebrow">Every agent gets a desk</p>
          <h2 id="mobile-menu-title">Where to?</h2>
          <nav className="menu-cards" aria-label="Mobile navigation">
            <a className="featured" href="#how" onClick={close}>
              <span className="menu-symbol" aria-hidden="true">
                ▦
              </span>
              <span>
                <strong>How it works</strong>
                <small>Four agents, one office, one glance.</small>
              </span>
              <span aria-hidden="true">→</span>
            </a>
            {SECTION_CARDS.map((card) => (
              <a key={card.href} href={card.href} onClick={close}>
                <span className="menu-symbol" aria-hidden="true">
                  {card.symbol}
                </span>
                <strong>{card.title}</strong>
                <small>{card.detail}</small>
              </a>
            ))}
          </nav>
          <div className="menu-section-title">
            <h3>Build with Bureau</h3>
            <span>Docs, setup, and internals.</span>
          </div>
          <nav className="menu-links" aria-label="Resources">
            {RESOURCES.map((link) => (
              <a key={link.href} href={link.href} onClick={close} {...(link.external ? { target: '_blank', rel: 'noreferrer' } : {})}>
                <span>{link.title}</span>
                <small>{link.detail}</small>
                <span aria-hidden="true">{link.external ? '↗' : '→'}</span>
              </a>
            ))}
          </nav>
        </div>
        <div className="menu-footer">
          <a href={SITE.github} target="_blank" rel="noreferrer">
            <Logo icon={github} /> GitHub
          </a>
          <a href={SITE.issues} target="_blank" rel="noreferrer">
            Feedback &amp; issues ↗
          </a>
        </div>
      </dialog>
    </>
  );
}
