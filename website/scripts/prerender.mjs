// Bakes the rendered page into dist/index.html so crawlers and link unfurlers
// see real content without running JavaScript; the client bundle hydrates it.
import { readFile, rm, writeFile } from 'node:fs/promises';
import { copyLicenseNotices } from '../../scripts/license-notices.mjs';

const { render } = await import('../dist-ssr/entry-server.js');
const template = await readFile('dist/index.html', 'utf8');
const marker = '<div id="root"></div>';
if (!template.includes(marker)) throw new Error(`missing ${marker} in dist/index.html`);

await writeFile('dist/index.html', template.replace(marker, `<div id="root">${render()}</div>`));
await rm('dist-ssr', { recursive: true, force: true });
await copyLicenseNotices('dist');
