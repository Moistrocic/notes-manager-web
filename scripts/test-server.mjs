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

/* -------------------------------------------------------------------------- */
/* Font store                                                                  */
/* -------------------------------------------------------------------------- */
const { FontStore } = await import(`file://${path.join(HERE, '..', 'server', 'dist', 'fonts', 'store.js').replace(/\\/g, '/')}`);
const { mkdtempSync, rmSync, readdirSync } = await import('node:fs');
const os = await import('node:os');

console.log('');
console.log('font store');

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'nm-fonts-'));
try {
  check('rejects an unknown extension', FontStore.classify('evil.exe'), null);
  check('accepts woff2', FontStore.classify('a.woff2')?.format, 'woff2');
  check('accepts ttf', FontStore.classify('a.ttf')?.format, 'truetype');
  check('accepts otf', FontStore.classify('a.otf')?.format, 'opentype');
  check('extension match is case insensitive', FontStore.classify('A.WOFF')?.format, 'woff');

  const store = new FontStore(dataDir);
  check('a fresh store is empty', store.list().fonts.length, 0);

  const added = store.add({ name: '演示字体', fileName: 'Demo Font.woff2', data: Buffer.alloc(1024, 3) });
  check('the font is registered', store.list().fonts.length, 1);
  check('the display name is kept', added.name, '演示字体');
  check('the size is recorded', added.size, 1024);
  check('the file is on disk', existsSync(store.filePath(added)), true);
  check('an index file is written', existsSync(path.join(dataDir, 'fonts', 'index.json')), true);

  check('the name falls back to the file name', store.add({ name: '  ', fileName: 'Fallback.ttf', data: Buffer.alloc(16) }).name, 'Fallback');
  check('an empty file is refused', (() => { try { store.add({ name: 'x', fileName: 'x.woff2', data: Buffer.alloc(0) }); return 'accepted'; } catch { return 'refused'; } })(), 'refused');
  check('an unsupported format is refused', (() => { try { store.add({ name: 'x', fileName: 'x.zip', data: Buffer.alloc(8) }); return 'accepted'; } catch { return 'refused'; } })(), 'refused');

  const selected = store.select({ sans: added.id, mono: added.id });
  check('a selection is stored', selected, { sans: added.id, mono: added.id });
  check('an unknown id is ignored', store.select({ sans: 'nope' }).sans, '');

  // The requirement: it has to survive a restart.
  // At this point the unknown id was rejected (sans cleared) and mono still
  // points at the font added first.
  check('the unknown id did not clear the other role', store.list().selection.mono, added.id);
  const reopened = new FontStore(dataDir);
  check('fonts survive a restart', reopened.list().fonts.map((f) => f.name), ['演示字体', 'Fallback']);
  check('the selection survives a restart', reopened.list().selection, { sans: '', mono: added.id });
  check('the font is still downloadable after a restart', existsSync(reopened.filePath(reopened.list().fonts.find((f) => f.id === added.id))), true);

  const store2 = new FontStore(dataDir);
  store2.select({ mono: store2.list().fonts.find((f) => f.name === '演示字体').id });
  const store3 = new FontStore(dataDir);
  check('a re-selected font survives too', store3.list().selection.mono.length > 0, true);

  // Deleting the file behind the store's back must not leave a ghost entry.
  const ghost = store3.list().fonts[0];
  rmSync(store3.filePath(ghost), { force: true });
  check('a missing file drops the entry', new FontStore(dataDir).list().fonts.some((f) => f.id === ghost.id), false);

  // Removing through the API deletes the file and clears the selection.
  const keep = store.add({ name: 'Keep', fileName: 'keep.woff2', data: Buffer.alloc(32) });
  const drop = store.add({ name: 'Drop', fileName: 'drop.woff2', data: Buffer.alloc(32) });
  store.select({ sans: drop.id });
  const dropPath = store.filePath(drop);
  check('remove reports success', store.remove(drop.id), true);
  check('the file is gone from disk', existsSync(dropPath), false);
  check('the entry is gone', store.list().fonts.some((f) => f.id === drop.id), false);
  check('the selection is cleared with it', new FontStore(dataDir).list().selection.sans, '');
  check('removing twice reports failure', store.remove(drop.id), false);
  check('the other font is untouched', new FontStore(dataDir).list().fonts.some((f) => f.id === keep.id), true);
  check(
    'every indexed font has a file and nothing else is left',
    readdirSync(path.join(dataDir, 'fonts')).filter((f) => /\.(woff2|woff|ttf|otf)$/i.test(f)).length,
    new FontStore(dataDir).list().fonts.length,
  );
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
