import { findPage, pageHref } from './pages.ts';
import { DocIcon } from './DocIcon.tsx';

export function DocCards({ links }: { links: { label: string; href: string }[] }) {
  const icons: Record<string, string> = {
    'node-script': 'terminal',
    'shell-script': 'shell',
    'ci-task': 'server',
    'cron-message': 'folder',
  };
  return (
    <div className="doc-card-grid">
      {links.map((link) => {
        const target = findPage(link.href);
        const icon = icons[link.href.split('/').at(-1) ?? ''] ?? 'terminal';
        return (
          <a className="doc-card" key={link.href} href={pageHref(link.href)}>
            <DocIcon name={icon} />
            <strong>{link.label}</strong>
            <p>{target?.description}</p>
            <span className="doc-card-arrow" aria-hidden="true">
              ↗
            </span>
          </a>
        );
      })}
    </div>
  );
}
