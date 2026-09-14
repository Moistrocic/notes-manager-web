#!/usr/bin/env node
/**
 * Repository hygiene check.
 *
 * Verifies that every source file on disk is actually tracked by git. This
 * guards against over-broad `.gitignore` patterns silently dropping source
 * files from the repository (which only shows up on a fresh clone).
 *
 *   node scripts/check-repo-files.mjs
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
/** Directories that are generated or installed, never committed. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.npm-cache', 'dist', '.ssr-out', 'tmp', 'data']);
/** Directories ignored only at the repository root (the OpenList reference clone). */
const SKIP_TOP = new Set(['openlist']);
/** Local-only files that are intentionally not committed (see .gitignore). */
const SKIP_FILES = new Set(['.npmrc', '.env', '.env.local']);

function walk(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (!rel && SKIP_TOP.has(entry.name)) continue;
      out.push(...walk(dir, childRel));
    } else if (entry.isFile()) {
      out.push(childRel);
    }
  }
  return out;
}

const disk = walk(ROOT)
  .filter((f) => !SKIP_FILES.has(f))
  .sort();
const tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean).sort();

const missingFromRepo = disk.filter((f) => !tracked.includes(f));
const missingOnDisk = tracked.filter((f) => !disk.includes(f));

console.log(`${disk.length} source files on disk, ${tracked.length} tracked by git`);

if (missingFromRepo.length) {
  console.error('\nThese files exist on disk but are NOT in the repository:');
  for (const f of missingFromRepo) console.error(`  - ${f}`);
  console.error('\nCheck .gitignore for an over-broad pattern (anchor it with a leading "/").');
}
if (missingOnDisk.length) {
  console.error('\nThese files are tracked but missing on disk:');
  for (const f of missingOnDisk) console.error(`  - ${f}`);
}
if (missingFromRepo.length || missingOnDisk.length) process.exit(1);
console.log('Repository file check passed');
