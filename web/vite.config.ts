import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8080';

/**
 * The app can be served from a sub path (BASE_PATH / --base-path on install).
 * Vite needs that value at build time so that asset URLs stay correct.
 */
function normaliseBase(raw: string | undefined): string {
  let value = (raw ?? '').trim();
  if (!value || value === '/') return '/';
  if (!value.startsWith('/')) value = `/${value}`;
  if (!value.endsWith('/')) value = `${value}/`;
  return value;
}

export default defineConfig({
  base: normaliseBase(process.env.VITE_BASE_PATH),
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks: {
          editor: ['codemirror', '@codemirror/lang-markdown', '@codemirror/view', '@codemirror/state'],
          markdown: ['marked', 'dompurify', 'highlight.js'],
          motion: ['framer-motion'],
        },
      },
    },
  },
});
