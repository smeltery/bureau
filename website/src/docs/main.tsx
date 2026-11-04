import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiDocs } from './ApiDocs.tsx';
import { findPage } from './pages.ts';
import './docs-base.css';

const page = findPage(window.location.pathname);
if (page) document.title = `${page.title} — bureau docs`;

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

createRoot(root).render(
  <StrictMode>
    <ApiDocs />
  </StrictMode>,
);
