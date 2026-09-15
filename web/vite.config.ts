import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
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

/**
 * Serves a scene.pkg to the test bench without copying it into the repository.
 *
 * Development only, and only when SCENE_PKG names a file - the package belongs
 * to the person testing, not to the project, and a 45 MB asset has no business
 * being committed or walked by the repository check.
 */
function sceneLabPkg(): Plugin {
  return {
    name: 'scene-lab-pkg',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/scene.pkg', (_req, res, next) => {
        const file = process.env.SCENE_PKG;
        if (!file) {
          res.statusCode = 404;
          res.end('SCENE_PKG is not set');
          return;
        }
        if (!fs.existsSync(file)) {
          res.statusCode = 404;
          res.end(`SCENE_PKG points at nothing: ${file}`);
          return;
        }
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', String(fs.statSync(file).size));
        fs.createReadStream(file).on('error', next).pipe(res);
      });
    },
  };
}

export default defineConfig({
  base: normaliseBase(process.env.VITE_BASE_PATH),
  plugins: [react(), tailwindcss(), sceneLabPkg()],
  server: {
    port: 5173,
    watch: {
      /**
       * Editors save by writing a temporary file and renaming it, and the
       * window between the two is enough for the watcher to try to watch a file
       * that is still open - which kills the dev server with EBUSY. Seen in the
       * wild as both ".name.ts.<pid>.<uuid>.tmpdir/name.ts.tmp" and
       * "name.ts~RF123456.TMP", so this matches on the shape rather than a
       * fixed list.
       */
      ignored: (path: string) => /\.tmpdir[\\/]|~RF\d+\.[Tt][Mm][Pp]$|\.tmp$/i.test(path),
    },
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
