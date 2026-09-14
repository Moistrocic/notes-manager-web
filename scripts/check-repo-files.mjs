#!/usr/bin/env node
/**
 * Repository hygiene check.
 *
 * Verifies that every source file on disk is actually tracked by git. This
 * guards against over-broad `.gitignore` patterns silently dropping source
 * files from the repository (which only shows up on a fresh clone).
 *
 * It also refuses to let runtime state into the repository. That is not
 * hypothetical: before the ignore rules were anchored, "git add -A" staged
 * data/settings.json and data/sessions.json, so a real session signing key and
 * live session records ended up in the object database. They were never part
 * of a commit and never pushed, but the guard belongs here rather than in a
 * comment about being careful.
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

/* -------------------------------------------------------------------------- */
/* Credential guard                                                           */
/* -------------------------------------------------------------------------- */
/** Tracked paths that are deliberately committed. */
const ALLOWED_PATHS = new Set(['.env.example']);

/** Paths that must never be tracked, however .gitignore is written today. */
const FORBIDDEN_PATHS = [
  [/(^|\/)\.env$/, 'environment file, holds real secrets'],
  [/(^|\/)\.env\.(local|production|prod|development|dev)$/, 'environment file, holds real secrets'],
  [/(^|\/)data\//, 'runtime data directory'],
  [/(^|\/)(sessions|settings|state)\.json$/, 'runtime state file'],
  [/(^|\/)initial-admin\.txt$/, 'generated administrator password'],
  [/(^|\/)id_(rsa|ed25519|ecdsa)$/, 'SSH private key'],
  [/\.(pem|key|p12|pfx)$/, 'private key material'],
  [/\.log$/, 'log file'],
];

/** Content signatures of this application's own runtime state. */
const FORBIDDEN_CONTENT = [
  [/"sessionSecret"\s*:/, 'a session signing key'],
  [/"adminPasswordHash"\s*:/, 'an administrator password hash'],
  [/"openlistToken"\s*:/, 'a cached OpenList token'],
];

/** Only checked inside .env files: elsewhere these are ordinary test fixtures. */
const ENV_FILE = /(^|\/)\.env/;
// [ \t] rather than \s on purpose: \s would cross the newline, let the value
// match the "#" of the next comment line, and flag every empty placeholder.
const FORBIDDEN_ENV_ASSIGNMENT = /^[ \t]*(OPENLIST_TOKEN|ADMIN_PASSWORD|SESSION_SECRET)[ \t]*=[ \t]*[^ \t\r\n#]\S*/m;
const ENV_ASSIGNMENT_WHY = 'a filled-in secret in a committed .env file';

const violations = [];
for (const file of tracked) {
  if (ALLOWED_PATHS.has(file)) continue;
  for (const [pattern, why] of FORBIDDEN_PATHS) {
    if (pattern.test(file)) violations.push(`${file}  -  ${why}`);
  }
}

for (const file of tracked) {
  let text;
  try {
    const buffer = fs.readFileSync(path.join(ROOT, file));
    if (buffer.includes(0)) continue; // binary
    if (buffer.length > 2 * 1024 * 1024) continue; // far too large to be state
    text = buffer.toString('utf8');
  } catch {
    continue;
  }
  for (const [pattern, why] of FORBIDDEN_CONTENT) {
    if (pattern.test(text)) violations.push(`${file}  -  contains ${why}`);
  }
  if (ENV_FILE.test(file) && FORBIDDEN_ENV_ASSIGNMENT.test(text)) {
    violations.push(`${file}  -  ${ENV_ASSIGNMENT_WHY}`);
  }
}

if (violations.length) {
  console.error('\nRuntime state or credentials are tracked by git:');
  for (const v of violations) console.error(`  - ${v}`);
  console.error('\nThese must never leave the machine they were generated on.');
  console.error('Remove them from the index (git rm --cached <path>) and make sure');
  console.error('.gitignore covers them, then rewrite the commit if it was pushed.');
  process.exitCode = 1;
} else {
  console.log(`Credential guard passed (${tracked.length} tracked files scanned)`);
}

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
