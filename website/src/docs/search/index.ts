import { pageHref, type DocPage } from '../pages.ts';

export interface SearchResult {
  page: DocPage;
  href: string;
  excerpt: string;
  section?: string;
  score: number;
}
export function searchPages(pages: DocPage[], query: string): SearchResult[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) {
    const popular = ['/docs', '/docs/quick-start', '/docs/guides/authentication', '/docs/guides/messaging-agents', '/docs/guides/reading-replies', '/docs/guides/tasks'];
    return popular.flatMap((path) => {
      const page = pages.find((item) => item.path === path);
      return page ? [{ page, href: pageHref(page.path), excerpt: page.description, score: 0 }] : [];
    });
  }
  return pages
    .flatMap((page) => {
      const sections = page.sections.map((section) => ({
        section,
        text: [section.title, ...section.paragraphs, ...(section.items ?? []), ...(section.table?.flat() ?? []), section.code ?? ''].join(' '),
      }));
      const title = page.title.toLowerCase(),
        description = page.description.toLowerCase();
      const all = [title, description, ...sections.map((item) => item.text.toLowerCase())].join(' ');
      if (!terms.every((term) => all.includes(term))) return [];
      const ranked = sections
        .map((item) => ({
          ...item,
          score: terms.reduce((sum, term) => sum + (item.section.title.toLowerCase().includes(term) ? 8 : 0) + (item.text.toLowerCase().includes(term) ? 2 : 0), 0),
        }))
        .sort((a, b) => b.score - a.score);
      const best = ranked[0];
      const titleMatch = terms.every((term) => title.includes(term));
      const score = terms.reduce((sum, term) => sum + (title.includes(term) ? 20 : 0) + (description.includes(term) ? 5 : 0), 0) + (best?.score ?? 0);
      const text = titleMatch ? page.description : (best?.text ?? page.description);
      const matchAt = Math.max(0, text.toLowerCase().indexOf(terms[0] ?? ''));
      const start = Math.max(0, matchAt - 55);
      const excerpt = `${start ? '…' : ''}${text.slice(start, start + 190)}${text.length > start + 190 ? '…' : ''}`;
      return [
        {
          page,
          href: `${pageHref(page.path)}${!titleMatch && best ? `#${best.section.id}` : ''}`,
          excerpt,
          section: !titleMatch ? best?.section.title : undefined,
          score,
        },
      ];
    })
    .sort((a, b) => b.score - a.score || a.page.title.localeCompare(b.page.title));
}
