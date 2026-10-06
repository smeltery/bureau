import { StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles/base.css';
import './styles/sections.css';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root');

hydrateRoot(
  root,
  <StrictMode>
    <App />
  </StrictMode>,
);
