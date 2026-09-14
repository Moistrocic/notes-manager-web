import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Build configuration for the render smoke test (`npm run check:render`).
 * It mounts the whole component tree in Node to catch import-time and
 * first-render errors without needing a browser.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    ssr: 'render-check.tsx',
    outDir: '.ssr-out',
    emptyOutDir: true,
    rollupOptions: { output: {} },
  },
});
