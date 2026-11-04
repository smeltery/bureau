import { useEffect, useRef, useState } from 'react';
import { DocsNavigation } from './DocsNavigation.tsx';

export function MobileNavigation() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector('a')?.focus();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  return (
    <div className="mobile-navigation">
      <button
        className="docs-menu-toggle"
        ref={trigger}
        type="button"
        aria-label={open ? 'Close navigation' : 'Open navigation'}
        aria-expanded={open}
        aria-controls="mobile-docs-nav"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d={open ? 'm6 6 12 12M6 18 18 6' : 'M4 6h16M4 12h16M4 18h16'} />
        </svg>
      </button>
      {open && (
        <div
          className="docs-mobile-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Documentation navigation"
          onKeyDown={(event) => {
            if (event.key === 'Escape') close();
            if (event.key === 'Tab') {
              const links = panel.current?.querySelectorAll<HTMLAnchorElement>('a');
              if (!links?.length) return;
              const first = links[0],
                last = links[links.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
              }
              if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
              }
            }
          }}
        >
          <button className="docs-menu-backdrop" type="button" onClick={close} aria-label="Close navigation" tabIndex={-1} />
          <div className="docs-mobile-panel docs-sidebar" id="mobile-docs-nav" ref={panel}>
            <DocsNavigation onNavigate={close} />
          </div>
        </div>
      )}
    </div>
  );
}
