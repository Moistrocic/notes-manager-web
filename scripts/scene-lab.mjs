#!/usr/bin/env node
/**
 * Starts the scene wallpaper test bench.
 *
 * A separate Vite server on its own port, so it can run beside the app without
 * either disturbing the other. Vite is used directly rather than through the
 * app's build because the point is to iterate: the bench reloads as the scene
 * modules change.
 *
 *   npm run scene-lab
 *   npm run scene-lab -- "C:\\Games\\Steam\\...\\3691554683\\scene.pkg"
 *
 * The path is optional. Without it the bench still works - pick or drop the
 * file on the page - and the "reload scene.pkg" button is what uses it.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const webDir = path.join(root, 'web');

const arg = process.argv.slice(2).find((value) => !value.startsWith('-'));
if (arg) {
  const resolved = path.resolve(arg);
  if (!fs.existsSync(resolved)) {
    console.error(`No such file: ${resolved}`);
    process.exit(1);
  }
  process.env.SCENE_PKG = resolved;
  console.log(`scene.pkg: ${resolved}`);
} else {
  console.log('No scene.pkg given - pick or drop one on the page, or pass a path as an argument.');
}

if (!fs.existsSync(path.join(webDir, 'src/lib/we-scene/src/pkg/container.js'))) {
  console.error('The we-scene submodule is missing. Run: git submodule update --init --recursive');
  process.exit(1);
}

console.log('Scene lab: http://127.0.0.1:9999/scene-lab.html');

const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const child = spawn(process.execPath, [vite, '--port', '9999', '--strictPort', '--host', '127.0.0.1'], {
  cwd: webDir,
  stdio: 'inherit',
  env: process.env,
});
child.on('exit', (code) => process.exit(code ?? 0));
