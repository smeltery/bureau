import { useState } from 'react';
import { BrandIcon } from '../BrandIcon.tsx';
import { SITE } from '../../site.ts';
import { pageMarkdown } from './markdown.ts';
import type { DocPage } from '../pages.ts';
import { DocIcon } from '../DocIcon.tsx';

export function DocActions({ page }: { page?: DocPage }) {
  const [status, setStatus] = useState('Copy as Markdown');
  const [fallback, setFallback] = useState(false);
  const markdown = pageMarkdown(page);
  const slug = page?.path.replace(/^\/docs\/?/, '') ?? '';
  const directory = slug.includes('/') ? `${slug.split('/')[0]}/` : '';
  const source = page ? `website/src/docs/content/${directory}${slug.replaceAll('/', '-') || 'overview'}.json` : 'website/src/docs/ApiDocs.tsx';
  const prompt = encodeURIComponent(`Help me use Bureau based on this documentation:\n\n${markdown}`);
  const providers = [
    ['ChatGPT', `https://chatgpt.com/?prompt=${prompt}`],
    ['Claude', `https://claude.ai/new?q=${prompt}`],
    ['v0', `https://v0.app/?q=${prompt}`],
    ['T3 Chat', `https://t3.chat/new?q=${prompt}`],
    ['Scira', `https://scira.ai/?q=${prompt}`],
    ['Cursor', `https://cursor.com/link/prompt?text=${prompt}`],
  ];
  async function copy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setStatus('Markdown copied');
    } catch {
      setFallback(true);
      setStatus('Select Markdown below');
    }
  }
  return (
    <div className="doc-actions">
      <a href={`${SITE.github}/edit/master/${source}`} target="_blank" rel="noreferrer">
        <BrandIcon name="GitHub" size={19} />
        Edit on GitHub
      </a>
      <button
        type="button"
        onClick={() =>
          window.scrollTo({
            top: 0,
            behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
          })
        }
      >
        <DocIcon name="up" />
        Scroll to top
      </button>
      <button type="button" onClick={copy} aria-live="polite">
        <DocIcon name="copy" />
        {status}
      </button>
      {fallback && <textarea readOnly aria-label="Page Markdown" value={markdown} onFocus={(event) => event.target.select()} />}
      <details>
        <summary>
          <DocIcon name="chat" />
          Open in chat
          <span className="action-chevron" aria-hidden="true">
            ⌄
          </span>
        </summary>
        <div className="chat-providers">
          {providers.map(([name, href]) => (
            <a key={name} href={href} target="_blank" rel="noreferrer">
              <BrandIcon name={name ?? ''} size={19} />
              <span>{name}</span>
              <DocIcon name="arrow" />
            </a>
          ))}
        </div>
        <p className="chat-note">Opens with this page’s documentation in the prompt.</p>
      </details>
    </div>
  );
}
