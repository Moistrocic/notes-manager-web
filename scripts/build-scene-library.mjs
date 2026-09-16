#!/usr/bin/env node
/**
 * Builds the scene wallpaper library that lives in a submodule.
 *
 * wallpaper-scene-layers is not on npm: the workspace depends on the directory
 * itself, and its package entry is `dist/index.js`, which is not committed - the
 * submodule builds it. Everything that imports the package needs that build to
 * have happened first, so this runs before the front end is built and from
 * `prepare`, which npm runs after an install.
 *
 * Without this, a fresh checkout fails at the first step that touches the
 * library: `Cannot find module 'wallpaper-scene-layers'` from the typecheck, and
 * the front end build's guard complaining that the library is not ready.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const library = path.join(root, 'web/src/lib/wallpaper-scene-layers');
const pkg = path.join(library, 'packages/we-scene');
const entry = path.join(pkg, 'dist/index.js');

/** A checkout without the submodule is not an error, just not ready. */
if (!fs.existsSync(path.join(pkg, 'src/index.ts'))) {
  console.warn('wallpaper-scene-layers is not checked out; run: git submodule update --init --recursive');
  process.exit(0);
}

function newestSource(dir) {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestSource(full));
    else if (entry.isFile()) newest = Math.max(newest, fs.statSync(full).mtimeMs);
  }
  return newest;
}

/** Nothing to do when the last build is newer than every source it came from. */
function upToDate() {
  if (!fs.existsSync(entry)) return false;
  const built = fs.statSync(entry).mtimeMs;
  const newest = Math.max(
    newestSource(path.join(pkg, 'src')),
    fs.statSync(path.join(pkg, 'package.json')).mtimeMs,
    fs.statSync(path.join(pkg, 'tsconfig.json')).mtimeMs,
  );
  return built >= newest;
}

if (upToDate()) {
  console.log('scene library is up to date');
  process.exit(0);
}

// The TypeScript that is already installed at the root, rather than a second
// install inside the submodule (which the installer does not do either).
const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
if (!fs.existsSync(tsc)) {
  console.warn('typescript is not installed; skipping the scene library build');
  console.warn('dynamic scene wallpapers will not work until it is built');
  process.exit(0);
}

console.log('building the scene library');
const result = spawnSync(process.execPath, [tsc, '-p', path.join('packages', 'we-scene')], {
  cwd: library,
  stdio: 'inherit',
});
if (result.status !== 0) {
  console.error('the scene library failed to build');
  process.exit(result.status ?? 1);
}