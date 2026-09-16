#!/usr/bin/env node
/**
 * Unit tests for the server helpers that are easy to get wrong.
 *
 *   node scripts/test-server.mjs          (run "npm run build:server" first)
 *
 * Covers `resolveRootForAccount`, the rule that keeps an OpenList account from
 * being sent to `/base/base/notes`.
 */
import { existsSync, writeFileSync } from 'node:fs';
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
  // The store sorts with localeCompare, whose result depends on the server's
  // locale (zh-CN puts Han first, en-US puts Latin first). Compare as a set
  // using a fixed ordering so the test does not depend on the runner's locale.
  const names = reopened.list().fonts.map((f) => f.name).sort();
  check('fonts survive a restart', names, ['Fallback', '演示字体'].sort());
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

// The bundled fonts (Cascadia Code and friends) live in the front end, so the
// server only ever stores the id. It must accept one it cannot look up, and it
// must not lose an explicit "system default" on the next start.
{
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nm-builtin-'));
  try {
    check('a new installation starts on the bundled font', new FontStore(dir).list().selection, {
      sans: '',
      mono: 'builtin:cascadia-code',
    });

    const store = new FontStore(dir);
    check('a bundled id is accepted', store.select({ mono: 'builtin:anything' }).mono, 'builtin:anything');
    check('an unknown id is still rejected', store.select({ mono: 'nope' }).mono, '');

    // An explicit "system default" is a choice, not a missing value.
    const chosen = new FontStore(dir);
    chosen.select({ mono: '' });
    check('clearing the choice is remembered', new FontStore(dir).list().selection.mono, '');

    // Deleting an uploaded font must not disturb a bundled selection.
    const store2 = new FontStore(dir);
    store2.select({ mono: 'builtin:cascadia-code' });
    const uploaded = store2.add({ name: 'Mine', fileName: 'mine.woff2', data: Buffer.alloc(16) });
    store2.select({ sans: uploaded.id });
    store2.remove(uploaded.id);
    const after = new FontStore(dir).list().selection;
    check('removing an upload leaves the bundled choice alone', after.mono, 'builtin:cascadia-code');
    check('and clears only the upload', after.sans, '');

    // A file written by an older version has no mono field at all.
    writeFileSync(path.join(dir, 'fonts', 'index.json'), JSON.stringify({ fonts: [], selection: { sans: '' } }), 'utf8');
    check('an old index file without mono gets the default', new FontStore(dir).list().selection.mono, 'builtin:cascadia-code');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* -------------------------------------------------------------------------- */
/* Default background                                                          */
/* -------------------------------------------------------------------------- */
const { BackgroundStore, adoptManifest, kindOf } = await import(
  `file://${path.join(HERE, '..', 'server', 'dist', 'backgrounds', 'store.js').replace(/\\/g, '/')}`,
);
const { SettingsStore } = await import(`file://${path.join(HERE, '..', 'server', 'dist', 'config.js').replace(/\\/g, '/')}`);
const { mkdirSync } = await import('node:fs');

console.log('');
console.log('default background');

check('a picture is a picture', kindOf('wall.jpg'), 'image');
check('a video is a video', kindOf('loop.webm'), 'video');
check('a container is a scene', kindOf('scene.pkg'), 'scene');
check('extension match is case insensitive', kindOf('WALL.PNG'), 'image');
check('anything else is nothing', kindOf('notes.md'), null);

{
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nm-bg-'));
  try {
    const store = new BackgroundStore(dir);
    mkdirSync(store.dir, { recursive: true });
    writeFileSync(path.join(store.dir, 'loop.mp4'), Buffer.alloc(2048));
    writeFileSync(path.join(store.dir, 'still.png'), Buffer.alloc(1024));
    writeFileSync(path.join(store.dir, 'rossi.pkg'), Buffer.alloc(4096));
    writeFileSync(path.join(store.dir, 'notes.txt'), 'ignore me');
    writeFileSync(path.join(store.dir, '.hidden.png'), Buffer.alloc(8));

    const listed = store.list();
    check('only the files it can serve are listed', listed.map((f) => f.name), ['rossi.pkg', 'loop.mp4', 'still.png']);
    check('the scene comes first', listed[0].kind, 'scene');
    check('sizes come from disk', listed[0].bytes, 4096);
    check('a name finds its file', store.find('loop.mp4')?.kind, 'video');
    check('an absent name finds nothing', store.find('nope.png'), null);
    check('a path is not a name', store.resolve('../secret.png'), null);
    check('a listed name resolves inside the folder', path.basename(store.resolve('still.png') ?? ''), 'still.png');
    check('a pkg is served as bytes', store.contentType(store.find('rossi.pkg')), 'application/octet-stream');
    check('a video keeps its own type', store.contentType(store.find('loop.mp4')), 'video/mp4');

    // What the settings dialog saves, and what the layer reads back.
    const settings = new SettingsStore(dir);
    check('a fresh install has no default background', settings.effective().background.kind, 'off');
    check('and therefore locks nobody', settings.effective().background.file, '');

    settings.update({
      background: {
        kind: 'scene',
        file: 'rossi.pkg',
        note: '洛茜 Rossi',
        crop: { x: -1, y: 0.9, w: 0.001, h: 0.5 },
        blur: 400,
        dim: 9,
        dynamic: true,
        auroraA: '#AABBCC',
        auroraB: 'not a colour',
      },
    });
    const saved = new SettingsStore(dir).effective().background;
    check('the choice is remembered', [saved.kind, saved.file, saved.note], ['scene', 'rossi.pkg', '洛茜 Rossi']);
    check('a wild selection is clamped into the picture', saved.crop, { x: 0, y: 0.5, w: 0.05, h: 0.5 });
    check('blur is clamped to something a screen can show', saved.blur, 40);
    check('so is the dim', saved.dim, 0.85);
    check('a colour is normalised', saved.auroraA, '#aabbcc');
    check('and a non-colour falls back to the theme', saved.auroraB, '');
    check('a full height selection cannot be moved vertically', (() => {
      settings.update({ background: { ...settings.effective().background, crop: { x: 0.5, y: 0.9, w: 1, h: 1 } } });
      return settings.effective().background.crop;
    })(), { x: 0, y: 0, w: 1, h: 1 });
    check('an unknown kind is ignored', (() => {
      settings.update({ background: { ...saved, kind: 'hologram' } });
      return settings.effective().background.kind;
    })(), 'scene');

    // A hand written background.json predates the settings section.
    const legacy = mkdtempSync(path.join(os.tmpdir(), 'nm-bg-legacy-'));
    try {
      const legacyStore = new BackgroundStore(legacy);
      mkdirSync(legacyStore.dir, { recursive: true });
      writeFileSync(path.join(legacyStore.dir, 'rossi.pkg'), Buffer.alloc(16));
      writeFileSync(path.join(legacyStore.dir, 'background.json'), JSON.stringify({ file: 'rossi.pkg', kind: 'scene', note: '旧文件' }), 'utf8');
      const legacySettings = new SettingsStore(legacy);
      adoptManifest(legacySettings, legacyStore);
      const adopted = legacySettings.effective().background;
      check('background.json is imported once', [adopted.kind, adopted.file, adopted.note], ['scene', 'rossi.pkg', '旧文件']);
      check('and marked as taken', existsSync(path.join(legacyStore.dir, 'background.json')), false);
      check('nothing is read a second time', existsSync(path.join(legacyStore.dir, 'background.json.imported')), true);

      // Choosing 「不设置」 afterwards must not bring the old file back.
      legacySettings.update({ background: { ...adopted, kind: 'off', file: '' } });
      writeFileSync(path.join(legacyStore.dir, 'background.json.imported'), JSON.stringify({ file: 'rossi.pkg' }), 'utf8');
      adoptManifest(legacySettings, legacyStore);
      check('turning it off stays off', legacySettings.effective().background.kind, 'off');

      const missing = mkdtempSync(path.join(os.tmpdir(), 'nm-bg-missing-'));
      try {
        const missingStore = new BackgroundStore(missing);
        mkdirSync(missingStore.dir, { recursive: true });
        writeFileSync(path.join(missingStore.dir, 'background.json'), JSON.stringify({ file: 'gone.pkg' }), 'utf8');
        const missingSettings = new SettingsStore(missing);
        adoptManifest(missingSettings, missingStore);
        check('a manifest naming a missing file configures nothing', missingSettings.effective().background.kind, 'off');
      } finally {
        rmSync(missing, { recursive: true, force: true });
      }
    } finally {
      rmSync(legacy, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
