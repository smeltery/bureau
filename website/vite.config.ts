import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { docsPages } from './docs-build.ts';

export default defineConfig({
  plugins: [react(), docsPages()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { input: { main: 'index.html', docs: 'docs/api/index.html' } },
  },
});
