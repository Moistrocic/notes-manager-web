import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * we-scene is a git submodule, so a clone made without --recursive, or a ZIP
 * downloaded from the repository page, leaves that directory empty and every
 * import from it unresolved. Say so plainly here instead of letting the bundler
 * produce a wall of resolution errors.
 */
const WE_SCENE_ENTRY = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'src/lib/we-scene/src/pkg/container.js',
);
if (!fs.existsSync(WE_SCENE_ENTRY)) {
  throw new Error(
    `we-scene submodule is missing (${WE_SCENE_ENTRY} not found).\n` +
      'Run:  git submodule update --init --recursive',
  );
}

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
  // The scene worker pulls the WebGL renderer and the HLSL translator in
  // through a dynamic import, so only people who turn dynamic scenes on pay for
  // them. That makes the worker a code-splitting build, which the default
  // "iife" worker format cannot express - hence module workers. Every browser
  // this app supports has them.
  worker: {
    format: 'es',
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
