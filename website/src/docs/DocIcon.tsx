const paths: Record<string, string> = {
  terminal: 'M4 5h16v14H4zM7 9l3 3-3 3m6 0h4',
  shell: 'm5 6 6 6-6 6m9 0h6',
  server: 'M4 3h16v7H4zm0 11h16v7H4zM7 6h1m-1 11h1',
  folder: 'M3 7h7l2-3h9v15H3zM7 4H3v3',
  copy: 'M9 8h11v13H9zM5 16H3V3h12v2',
  up: 'm5 10 7-7 7 7M12 3v18',
  chat: 'M4 4h16v13H9l-5 4z',
  arrow: 'M14 3h7v7m0-7L10 14M10 4H3v17h17v-7',
};
export function DocIcon({ name }: { name: string }) {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={paths[name] ?? paths.terminal} />
    </svg>
  );
}
