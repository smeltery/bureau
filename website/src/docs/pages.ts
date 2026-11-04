export interface DocSection {
  id: string;
  title: string;
  paragraphs: string[];
  diagram?: 'message' | 'webhook';
  items?: string[];
  code?: string;
  language?: string;
  table?: string[][];
  links?: { label: string; href: string }[];
}
export interface DocPage {
  path: string;
  title: string;
  group: string;
  description: string;
  sections: DocSection[];
}
const modules = import.meta.glob<DocPage>('./content/**/*.json', {
  eager: true,
  import: 'default',
});
export const docGroups = ['Start here', 'Guides', 'Reference', 'API endpoints', 'Examples'];
export const pages = Object.values(modules).sort((a, b) => {
  const group = docGroups.indexOf(a.group) - docGroups.indexOf(b.group);
  if (group) return group;
  if (a.path === '/docs' || a.path === '/docs/examples') return -1;
  if (b.path === '/docs' || b.path === '/docs/examples') return 1;
  return a.title.localeCompare(b.title);
});
// Each page is a static <path>/index.html, so links carry the trailing slash
// that makes static hosts serve that file instead of falling back to `/`.
export function pageHref(path: string) {
  return path.replace(/\/?$/, '/');
}
export function findPage(path: string) {
  return pages.find((page) => page.path === path.replace(/\/$/, ''));
}
