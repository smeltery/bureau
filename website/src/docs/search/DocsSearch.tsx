import { useEffect, useMemo, useRef, useState } from 'react';
import { searchable } from './catalog.ts';
import { searchPages } from './index.ts';
import './search.css';

export function DocsSearch() {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const resultsList = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [preview, setPreview] = useState(true);
  const results = useMemo(() => searchPages(searchable, query), [query]);
  const selected = results[active];
  function open() {
    setQuery('');
    setActive(0);
    dialog.current?.showModal();
    input.current?.focus();
  }
  function close() {
    dialog.current?.close();
    trigger.current?.focus();
  }
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (dialog.current?.open) dialog.current.close();
        else {
          setQuery('');
          setActive(0);
          dialog.current?.showModal();
          input.current?.focus();
        }
      }
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  useEffect(() => {
    resultsList.current?.querySelector(`#search-result-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <>
      <button className="docs-search-trigger" ref={trigger} type="button" onClick={open} aria-label="Search documentation">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
          <circle cx="10" cy="10" r="7" />
          <path d="m15 15 6 6" />
        </svg>
        <span>Search docs</span>
        <kbd>⌘ K</kbd>
      </button>
      <dialog
        className="docs-search-dialog"
        ref={dialog}
        aria-label="Search documentation"
        onClose={() => trigger.current?.focus()}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((value) => (results.length ? (value + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length : 0));
          }
          if (event.key === 'Enter' && document.activeElement === input.current && selected) {
            event.preventDefault();
            window.location.assign(selected.href);
          }
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
            event.preventDefault();
            setPreview((value) => !value);
          }
        }}
      >
        <div className="search-input-row">
          <input
            ref={input}
            type="search"
            placeholder="Search documentation…"
            aria-label="Search documentation"
            role="combobox"
            aria-expanded="true"
            aria-controls="docs-search-results"
            aria-autocomplete="list"
            aria-activedescendant={selected ? `search-result-${active}` : undefined}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
          />
          <button type="button" onClick={close} aria-label="Close search">
            <kbd>Esc</kbd>
          </button>
        </div>
        <div className={`search-body ${preview ? '' : 'search-no-preview'}`}>
          <div className="search-results-pane">
            <p className="search-results-label" role="status">
              {query.trim() ? `${results.length} results` : 'Popular'}
            </p>
            <div role="listbox" aria-label="Documentation results" id="docs-search-results" ref={resultsList}>
              {results.map((result, index) => (
                <div role="option" tabIndex={-1} aria-selected={index === active} id={`search-result-${index}`} key={result.href}>
                  <a href={result.href} tabIndex={-1} onFocus={() => setActive(index)} onMouseEnter={() => setActive(index)}>
                    <span>{result.page.title}</span>
                    <small>{result.section ?? result.page.group}</small>
                  </a>
                </div>
              ))}
            </div>
            {!results.length && <p className="search-empty">No matching pages. Try “token”, “queue”, or “webhook”.</p>}
          </div>
          {preview && (
            <div className="search-preview">
              {selected && (
                <>
                  <p className="eyebrow">{selected.page.group}</p>
                  <h2>{selected.page.title}</h2>
                  <p>{selected.page.description}</p>
                  {selected.section && <h3>{selected.section}</h3>}
                  <p>{selected.section ? selected.excerpt : selected.page.sections[0]?.paragraphs[0]}</p>
                  <a href={selected.href}>Open documentation →</a>
                </>
              )}
            </div>
          )}
        </div>
        <footer className="search-footer">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <button type="button" onClick={() => setPreview((value) => !value)}>
            <kbd>⌘ J</kbd> {preview ? 'Hide' : 'Show'} preview
          </button>
        </footer>
      </dialog>
    </>
  );
}
