#!/usr/bin/env node
/**
 * Unit tests for the server helpers that are easy to get wrong.
 *
 *   node scripts/test-server.mjs          (run "npm run build:server" first)
 *
 * Covers `resolveRootForAccount`, the rule that keeps an OpenList account from
 * being sent to `/base/base/notes`.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANAGER = path.join(HERE, '..', 'server', 'dist', 'storage', 'manager.js');

if (!existsSync(MANAGER)) {
  console.error('server/dist is missing - run "npm run build:server" first');
  process.exit(1);
}

const { resolveRootForAccount } = await import(`file://${MANAGER.replace(/\\/g, '/')}`);

let failed = 0;
let passed = 0;
function check(name, actual, expected) {
  const got = JSON.stringify(actual);
  const want = JSON.stringify(expected);
  if (got === want) {
    passed += 1;
    console.log(`  ok    ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}\n          got ${got}, want ${want}`);
  }
}

console.log('resolveRootForAccount');

// No jail: the configured root is used as is.
check('base "/" keeps the root', resolveRootForAccount('/notes', '/').path, '/notes');
check('base "" keeps the root', resolveRootForAccount('/notes', '').path, '/notes');
check('base undefined keeps the root', resolveRootForAccount('/notes', undefined).path, '/notes');

// The case from the bug report: an account jailed to /public must NOT be sent
// to /public/Notes, because OpenList would join it into /public/public/Notes.
const jailed = resolveRootForAccount('/public/Notes', '/public');
check('jailed account strips its base path', jailed.path, '/Notes');
check('jailed account is allowed', jailed.accessible, true);

// Root equal to the jail: the base itself.
check('root equal to the base becomes /', resolveRootForAccount('/public', '/public').path, '/');

// Deeper nesting.
check('deeper nesting strips the base', resolveRootForAccount('/public/a/b', '/public').path, '/a/b');

// Outside the jail.
const outside = resolveRootForAccount('/other', '/public');
check('root outside the jail is refused', outside.accessible, false);
check('refusal explains why', /outside \/public/.test(outside.reason ?? ''), true);

// Trailing slashes and odd spacing must not confuse the comparison.
check('trailing slash on the base', resolveRootForAccount('/public/Notes', '/public/').path, '/Notes');
check('trailing slash on the root', resolveRootForAccount('/public/Notes/', '/public').path, '/Notes');
check('prefix must be a path segment', resolveRootForAccount('/publicity/Notes', '/public').accessible, false);
check('prefix must be a path segment (2)', resolveRootForAccount('/publicity/Notes', '/public').path, '/publicity/Notes');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
