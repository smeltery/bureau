import { docGroups, pageHref, pages } from './pages.ts';

export function DocsNavigation({ onNavigate }: { onNavigate?: () => void }) {
  const current = window.location.pathname.replace(/\/$/, '');
  return (
    <>
      <nav aria-label="Documentation pages">
        <a href="/docs/api/" onClick={onNavigate} aria-current={current === '/docs/api' ? 'page' : undefined}>
          API overview
        </a>
        {docGroups.map((group) => (
          <div className="docs-nav-group" key={group}>
            <p>{group}</p>
            {pages
              .filter((page) => page.group === group)
              .map((page) => (
                <a key={page.path} href={pageHref(page.path)} onClick={onNavigate} aria-current={current === page.path ? 'page' : undefined}>
                  {page.title}
                </a>
              ))}
          </div>
        ))}
      </nav>
      <a onClick={onNavigate} className="docs-home" href="/">
        ← Back to bureau
      </a>
    </>
  );
}
