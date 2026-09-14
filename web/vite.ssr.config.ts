import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Build configuration for the Node side checks (`npm run check:web`):
 *
 *   render-check.tsx - mounts the component tree and asserts on the markup
 *   store-check.tsx  - drives the store and asserts on the requests it makes
 */
export default defineConfig({
  plugins: [react()],
  build: {
    ssr: true,
    outDir: '.ssr-out',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        'render-check': 'render-check.tsx',
        'store-check': 'store-check.tsx',
        'outline-check': 'outline-check.tsx',
        'dom-check': 'dom-check.tsx',
      },
      output: { entryFileNames: '[name].js' },
    },
  },
});
