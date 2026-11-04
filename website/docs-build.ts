import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';
import type { DocPage } from './src/docs/pages.ts';

const CONTENT = 'src/docs/content';
const SHELL = 'docs/api/index.html';
const ORIGIN = 'https://bureau.smeltery.io';

function escapeAttribute(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

function sitemap(paths: string[]) {
  const entries = paths.map((path) => `  <url>\n    <loc>${ORIGIN}${path}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>${path === '/' ? '1.0' : '0.7'}</priority>\n  </url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
}

// Every content page is served from its own static index.html so links work
// without a rewrite layer; each copy gets the page's own title and description.
export function docsPages(): Plugin {
  let ssrBuild = false;
  return {
    name: 'bureau-doc-pages',
    config(_config, env) {
      ssrBuild = Boolean(env.isSsrBuild);
    },
    configureServer(server) {
      // Vite's dev server would fall back to the marketing index.html for docs routes.
      server.middlewares.use((req, _res, next) => {
        const path = req.url?.split('?')[0] ?? '';
        if (/^\/docs(\/[^.]*)?$/.test(path)) req.url = `/${SHELL}`;
        next();
      });
    },
    closeBundle() {
      if (ssrBuild) return;
      const shell = readFileSync(join('dist', SHELL), 'utf8');
      const urls = ['/', '/docs/api/'];
      for (const file of readdirSync(CONTENT, { recursive: true })) {
        if (!String(file).endsWith('.json')) continue;
        const page = JSON.parse(readFileSync(join(CONTENT, String(file)), 'utf8')) as DocPage;
        const html = shell
          .replace(/<title>.*?<\/title>/s, `<title>${escapeAttribute(page.title)} — bureau docs</title>`)
          .replace(/(<meta\s+name="description"\s+content=")[^"]*(")/s, `$1${escapeAttribute(page.description)}$2`);
        const output = join('dist', page.path, 'index.html');
        mkdirSync(dirname(output), { recursive: true });
        writeFileSync(output, html);
        urls.push(`${page.path}/`);
      }
      writeFileSync(join('dist', 'sitemap.xml'), sitemap(urls));
    },
  };
}
