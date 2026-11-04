import { highlightCode } from './rendering/highlight.ts';
import './rendering/code.css';
import { useMemo, useState } from 'react';

export function CodeBlock({ code, label }: { code: string; label: string }) {
  const html = useMemo(() => highlightCode(code, label), [code, label]);
  const [status, setStatus] = useState('Copy');
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setStatus('Copied');
    } catch {
      setStatus('Select code to copy');
    }
  }
  return (
    <div className="docs-code">
      <div className="docs-code-heading">
        <span>{label}</span>
        <button type="button" onClick={copy} aria-live="polite">
          {status}
        </button>
      </div>
      <pre className="highlighted-code">
        <span className="code-gutter" aria-hidden="true">
          {code
            .split('\n')
            .map((_, index) => index + 1)
            .join('\n')}
        </span>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: highlight.js escapes source text and emits only token spans. */}
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}
