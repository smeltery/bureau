'use client';

import React, { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/cjs/styles/prism';

interface CodeBlockProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
  className?: string;
}

export function CodeBlock({ code, language = 'bash', showLineNumbers = false, className = '' }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={`relative group ${className}`}>
      <div className="absolute right-3 top-3 z-10">
        <button
          onClick={handleCopy}
          className="px-3 py-1.5 text-xs font-medium bg-dark-gray/80 hover:bg-dark-slate/80 text-slate-gray hover:text-cream rounded border border-distill-purple transition-all opacity-0 group-hover:opacity-100"
          aria-label="Copy code"
        >
          {copied ? (
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Copied!
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy
            </span>
          )}
        </button>
      </div>
      <div className="bg-dark-slate border border-distill-purple/30 rounded-lg overflow-hidden">
        {language && (
          <div className="flex items-center justify-between px-3 sm:px-4 py-2 bg-dark-gray/50 border-b border-distill-purple/30">
            <span className="text-xs font-mono text-slate-gray uppercase tracking-wide">{language}</span>
          </div>
        )}
        <div className="overflow-x-auto">
          <SyntaxHighlighter
            language={language}
            style={vscDarkPlus}
            showLineNumbers={showLineNumbers}
            customStyle={{
              margin: 0,
              padding: '0.75rem',
              background: 'transparent',
              fontSize: '0.75rem',
              minWidth: '100%',
            }}
          codeTagProps={{
            style: {
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              whiteSpace: 'pre',
            },
          }}
          wrapLines={false}
          wrapLongLines={false}
        >
          {code}
        </SyntaxHighlighter>
        </div>
      </div>
    </div>
  );
}
