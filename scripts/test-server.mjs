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

/* -------------------------------------------------------------------------- */
/* Guest access                                                                */
/* -------------------------------------------------------------------------- */
const { AuthService } = await import(`file://${path.join(HERE, '..', 'server', 'dist', 'auth', 'service.js').replace(/\\/g, '/')}`);
const { StorageManager } = await import(`file://${path.join(HERE, '..', 'server', 'dist', 'storage', 'manager.js').replace(/\\/g, '/')}`);
const { StateStore } = await import(`file://${path.join(HERE, '..', 'server', 'dist', 'config.js').replace(/\\/g, '/')}`);

console.log('');
console.log('guest access');

{
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nm-guest-'));
  try {
    const settings = new SettingsStore(dir);
    const storage = new StorageManager(settings, dir);
    const state = new StateStore(dir);
    const config = { adminUsername: 'admin', authLocalEnabled: true, adminPasswordEnv: undefined, sessionTtlMs: 60_000 };
    const auth = new AuthService(config, state, settings, storage);

    // No OpenList at all: the notes are this server's own, and the visitor a
    // deployment like that can offer is a read-only local one.
    check('a deployment without OpenList offers a guest', await auth.guestAvailable(), true);
    const guest = await auth.loginAsGuest();
    check('who is anonymous', [guest.guest, guest.provider, guest.role], [true, 'local', 'user']);
    check('and cannot write anywhere', guest.permissions, { write: false, rename: false, move: false, remove: false });
    const result = await auth.login({ provider: 'guest', username: '', password: '' });
    check('signing in as a guest says where it happened', result.provider, 'local');
    check('and hands back the same visitor', result.user.guest, true);

    settings.update({ guest: { enabled: false } });
    check('turning guest access off withdraws the offer', await auth.guestAvailable(), false);
    check(
      'and refuses the sign-in',
      await auth.loginAsGuest().then(
        () => 'signed in',
        (err) => err.code,
      ),
      'guest_disabled',
    );

    settings.update({ guest: { enabled: true } });
    check('and turning it back on restores it', await auth.guestAvailable(), true);

    // The switch is about guests, not about the administrator.
    const admin = await auth
      .login({ provider: 'local', username: 'admin', password: 'wrong' })
      .then(() => 'signed in',
        (err) => err.message,
      );
    check('the administrator still cannot sign in with the wrong password', admin, 'Invalid username or password');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* -------------------------------------------------------------------------- */
/* Content hashes                                                              */
/* -------------------------------------------------------------------------- */
console.log('');
console.log('background hashes');

{
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nm-hash-'));
  try {
    const store = new BackgroundStore(dir);
    mkdirSync(store.dir, { recursive: true });
    writeFileSync(path.join(store.dir, 'scene.pkg'), Buffer.alloc(4096, 7));

    const first = await store.hash('scene.pkg');
    check('a file has a hash', typeof first === 'string' && first.length > 0, true);
    check('asking again gives the same one', await store.hash('scene.pkg'), first);
    check('and a file it does not have gives none', await store.hash('nope.pkg'), null);

    // The point of hashing: the same name with different bytes is a different
    // wallpaper, and the browser has to be told so.
    writeFileSync(path.join(store.dir, 'scene.pkg'), Buffer.alloc(4096, 8));
    const second = await store.hash('scene.pkg');
    check('different contents are a different hash', second !== first, true);

    // Same contents, different name: the hash follows the bytes, not the path.
    writeFileSync(path.join(store.dir, 'copy.pkg'), Buffer.alloc(4096, 8));
    check('the same contents hash the same', await store.hash('copy.pkg'), second);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* -------------------------------------------------------------------------- */
/* Renaming a title, moving a folder                                           */
/* -------------------------------------------------------------------------- */
const express = (await import('express')).default;
const { readFileSync } = await import('node:fs');
const { NotesRepository } = await import(
  'file://' + path.join(HERE, '..', 'server', 'dist', 'notes', 'repository.js').replace(/\\/g, '/')
);
const { LocalStorageDriver } = await import(
  'file://' + path.join(HERE, '..', 'server', 'dist', 'storage', 'local.js').replace(/\\/g, '/')
);
const { OpenListStorageDriver } = await import(
  'file://' + path.join(HERE, '..', 'server', 'dist', 'storage', 'openlist.js').replace(/\\/g, '/')
);
const { notesRoutes } = await import(
  'file://' + path.join(HERE, '..', 'server', 'dist', 'http', 'routes', 'notes.js').replace(/\\/g, '/')
);

console.log('');
console.log('note rename + folder move');

{
  // The routes are mounted on a throwaway app, so every assertion below goes
  // through the same handlers, body parsing and error mapping the server uses.
  const root = mkdtempSync(path.join(os.tmpdir(), 'nm-move-'));
  const driver = new LocalStorageDriver(root);
  const notes = new NotesRepository({
    resolve: async () => ({ driver, kind: 'local', displayRoot: root, degraded: false, detail: 'test' }),
  });
  const session = {
    username: 'admin',
    provider: 'local',
    role: 'admin',
    guest: false,
    permissions: { write: true, rename: true, move: true, remove: true },
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = session;
    next();
  });
  app.use('/api/notes', notesRoutes({ notes }));

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/notes';

  const call = async (method, url, body) => {
    const response = await fetch(base + url, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }
    return { status: response.status, payload };
  };

  const fsPath = (storagePath) => path.join(root, ...storagePath.replace(/^\//, '').split('/'));
  const onDisk = (storagePath) => existsSync(fsPath(storagePath));
  const folderPaths = (payload) => (payload.folders ?? []).map((folder) => folder.path);

  // Raw-body uploads, the way the browser sends them: the bytes are the body
  // and the names ride in headers, percent-encoded because headers are latin-1.
  const upload = async (name, bytes, folder) => {
    const response = await fetch(base + '/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Note-Filename': encodeURIComponent(name),
        ...(folder ? { 'X-Note-Folder': encodeURIComponent(folder) } : {}),
      },
      body: bytes,
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }
    return { status: response.status, payload };
  };

  // A response whose body is the bytes themselves, not JSON.
  const getBytes = async (url) => {
    const response = await fetch(base + url);
    const body = Buffer.from(await response.arrayBuffer());
    return {
      status: response.status,
      type: response.headers.get('content-type'),
      disposition: response.headers.get('content-disposition') ?? '',
      body: [...body],
    };
  };

  try {
    /* ---- a new title renames the file on disk --------------------------- */
    const created = await call('POST', '', { title: '原始标题', content: '正文内容' });
    const id = created.payload.note.id;
    check('a note is created', [created.status, created.payload.note.path], [201, '/原始标题.md']);
    check('the file is on disk', onDisk('/原始标题.md'), true);

    const renamed = await call('PUT', '/' + id, { title: 'Renamed Note' });
    check('the rename succeeds', renamed.status, 200);
    check('the file is named after the new title', renamed.payload.note.path, '/Renamed-Note.md');
    check('the renamed file is on disk', onDisk('/Renamed-Note.md'), true);
    check('the old file is gone', onDisk('/原始标题.md'), false);
    check('the id does not change', renamed.payload.note.id, id);
    check('the title does change', renamed.payload.note.title, 'Renamed Note');
    // The serialiser always ends the file with a newline, so the body comes back
    // exactly as create() returned it - which is the point of the assertion.
    check('the body is untouched', [renamed.payload.note.content, renamed.payload.note.content.trimEnd()], [created.payload.note.content, '正文内容']);
    check('the front matter keeps the id', readFileSync(fsPath('/Renamed-Note.md'), 'utf8').includes('id: ' + id), true);
    check('only one note is left', (await call('GET', '')).payload.notes.length, 1);

    // Deep links are by id, so they have to survive the rename.
    const byId = await call('GET', '/' + id);
    check('the note is still reachable by id', [byId.status, byId.payload.note.path], [200, '/Renamed-Note.md']);

    // A patch that does not touch the title must not move the file.
    const edited = await call('PUT', '/' + id, { content: '改过的正文' });
    check('editing the body keeps the file name', edited.payload.note.path, '/Renamed-Note.md');
    check('and stores the new body', edited.payload.note.content.trimEnd(), '改过的正文');

    const blank = await call('PUT', '/' + id, { title: '   ' });
    check('a blank title keeps the old title', blank.payload.note.title, 'Renamed Note');
    check('and does not rename the file', blank.payload.note.path, '/Renamed-Note.md');

    // A name that is already taken gets a free one, the same way create() does.
    const other = await call('POST', '', { title: 'Other', content: 'other' });
    const collided = await call('PUT', '/' + other.payload.note.id, { title: 'Renamed Note' });
    check('a taken name gets a free one', collided.payload.note.path, '/Renamed-Note-2.md');
    check('both files are on disk', [onDisk('/Renamed-Note.md'), onDisk('/Renamed-Note-2.md')], [true, true]);

    // .markdown is a note too, and the extension belongs to the file.
    writeFileSync(path.join(root, 'manual.markdown'), '---\nid: manualnote\ntitle: 手工\n---\n\n手工正文\n', 'utf8');
    notes.clearCaches();
    const manual = await call('PUT', '/manualnote', { title: 'Manual Note' });
    check('a .markdown note is found by id', manual.status, 200);
    check('the extension is kept', manual.payload.note.path, '/Manual-Note.markdown');
    check('the renamed .markdown file is on disk', onDisk('/Manual-Note.markdown'), true);
    check('and its old name is gone', onDisk('/manual.markdown'), false);

    /* ---- moving a folder ------------------------------------------------ */
    const madeProject = await call('POST', '/folders', { path: '项目' });
    check('a folder is created', [madeProject.status, folderPaths(madeProject.payload).includes('项目')], [201, true]);
    await call('POST', '/folders', { path: '归档' });

    const inFolder = await call('POST', '', { title: '计划', content: '计划正文', folder: '项目' });
    check('a note can be created inside it', inFolder.payload.note.path, '/项目/计划.md');
    check('the file is inside the folder on disk', onDisk('/项目/计划.md'), true);

    const movedFolder = await call('POST', '/folders/move', { path: '项目', target: '归档' });
    check('the folder moves', [movedFolder.status, movedFolder.payload.ok, movedFolder.payload.path], [200, true, '归档/项目']);
    check('the folder and its note are at the new place', [onDisk('/归档/项目'), onDisk('/归档/项目/计划.md')], [true, true]);
    check('the old folder is gone', onDisk('/项目'), false);
    check('the folder list follows', folderPaths(movedFolder.payload), ['归档', '归档/项目']);

    const listed = (await call('GET', '')).payload.notes.find((note) => note.id === inFolder.payload.note.id);
    check('the note reports its new path', [listed.path, listed.folder], ['/归档/项目/计划.md', '归档/项目']);

    const back = await call('POST', '/folders/move', { path: '归档/项目', target: '' });
    check('a folder can be moved back to the root', [back.status, back.payload.path], [200, '项目']);
    check('and it is back at the root on disk', [onDisk('/项目/计划.md'), onDisk('/归档/项目')], [true, false]);

    /* ---- what a move refuses -------------------------------------------- */
    const intoItself = await call('POST', '/folders/move', { path: '项目', target: '项目' });
    check('a folder cannot move into itself', [intoItself.status, intoItself.payload.error.code], [400, 'invalid_target']);
    const intoChild = await call('POST', '/folders/move', { path: '项目', target: '项目/子' });
    check('nor into its own subfolder', [intoChild.status, intoChild.payload.error.code], [400, 'invalid_target']);
    const missingTarget = await call('POST', '/folders/move', { path: '项目', target: '不存在' });
    check('an unknown destination is refused', [missingTarget.status, missingTarget.payload.error.code], [404, 'folder_not_found']);
    const missingFolder = await call('POST', '/folders/move', { path: '不存在', target: '' });
    check('an unknown folder is refused', [missingFolder.status, missingFolder.payload.error.code], [404, 'folder_not_found']);
    const intoTrash = await call('POST', '/folders/move', { path: '项目', target: '_trash' });
    check('the trash is not a destination', [intoTrash.status, intoTrash.payload.error.code], [400, 'invalid_folder']);

    // The 409 the UI shows when the destination already holds that folder.
    await call('POST', '/folders', { path: '归档/项目' });
    const duplicate = await call('POST', '/folders/move', { path: '项目', target: '归档' });
    check('a taken name at the destination is refused', [duplicate.status, duplicate.payload.error.code], [409, 'folder_exists']);
    check('neither folder was touched', [onDisk('/项目/计划.md'), onDisk('/归档/项目')], [true, true]);

    /* ---- a title and a folder in one request ---------------------------- */
    const combined = await call('PUT', '/' + inFolder.payload.note.id, { title: 'Plan B', folder: '归档' });
    check('renaming and moving in one request', [combined.status, combined.payload.note.path], [200, '/归档/Plan-B.md']);
    check('the note keeps its id and body', [combined.payload.note.id, combined.payload.note.content.trimEnd()], [inFolder.payload.note.id, '计划正文']);
    check('the new file is on disk', onDisk('/归档/Plan-B.md'), true);
    check('the old file is gone', onDisk('/项目/计划.md'), false);

    /* ---- a guest may not move anything ---------------------------------- */
    session.guest = true;
    const guestMove = await call('POST', '/folders/move', { path: '归档', target: '' });
    check('a local guest cannot move a folder', [guestMove.status, guestMove.payload.error.code], [403, 'guest_readonly']);
    session.guest = false;

    /* ---- uploading a file keeps the name it arrived under --------------- */
    // A real PNG signature followed by bytes no text decoder would survive, so
    // "the bytes came back unchanged" is a statement about the bytes.
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c48900ff', 'hex');

    const picture = await upload('风景.png', png);
    check('an image uploads under its own name', [picture.status, picture.payload.note.path, picture.payload.note.kind], [201, '/风景.png', 'image']);
    check('and the bytes are on disk unchanged', [...readFileSync(fsPath('/风景.png'))], [...png]);
    check('with no front matter prepended', [...readFileSync(fsPath('/风景.png')).subarray(0, 8)], [...png.subarray(0, 8)]);

    const duplicateImage = await upload('风景.png', png);
    check('a taken name gets -2, keeping the extension', duplicateImage.payload.note.path, '/风景-2.png');
    check('as a separate entry', duplicateImage.payload.note.id !== picture.payload.note.id, true);

    const emptyNote = await upload('空白.md', Buffer.alloc(0));
    check('an empty .md uploads instead of being refused', [emptyNote.status, emptyNote.payload.note.path], [201, '/空白.md']);
    check('titled after the file, not a heading', [emptyNote.payload.note.title, emptyNote.payload.note.kind], ['空白', 'note']);
    check('with an empty body', emptyNote.payload.note.content.trim(), '');

    const headed = await upload('会议记录.md', Buffer.from('# 另一个标题\n\n正文\n', 'utf8'));
    check('a heading inside does not rename the note', [headed.payload.note.title, headed.payload.note.path], ['会议记录', '/会议记录.md']);
    check('and the uploaded front matter is dropped, not nested', readFileSync(fsPath('/会议记录.md'), 'utf8').match(/^---/g)?.length, 1);

    const textFile = await upload('说明.txt', Buffer.from('纯文本\n', 'utf8'));
    check('.txt is a note too', textFile.payload.note.kind, 'note');

    const withMatter = await upload('带元数据.md', Buffer.from('---\ntitle: 被忽略的标题\ntags: [旧]\n---\n\n正文\n', 'utf8'));
    check('an uploaded front matter block is replaced, not nested', [withMatter.payload.note.title, withMatter.payload.note.content.trim()], ['带元数据', '正文']);
    check('leaving exactly one block in the file', readFileSync(fsPath('/带元数据.md'), 'utf8').match(/^---$/gm).length, 2);

    // A .json file is served by the browser as application/json, which the
    // app-level JSON parser consumes before the raw parser sees it: the route
    // has to say so rather than store an empty file.
    const swallowed = await fetch(base + '/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Note-Filename': encodeURIComponent('数据.json') },
      body: JSON.stringify({ a: 1 }),
    });
    check('a body the JSON parser already ate is refused', [swallowed.status, (await swallowed.json()).error.code], [415, 'unsupported_upload']);
    check('and nothing was created for it', onDisk('/数据.json'), false);

    const emptyFile = await upload('空文件.bin', Buffer.alloc(0));
    check('any other file uploads, empty or not', [emptyFile.status, emptyFile.payload.note.path, emptyFile.payload.note.kind, emptyFile.payload.note.size], [201, '/空文件.bin', 'file', 0]);

    const listedFiles = (await call('GET', '')).payload;
    const listedImage = listedFiles.notes.find((note) => note.path === '/风景.png');
    check('the tree lists the picture as an image', [listedImage.kind, listedImage.title, listedImage.size], ['image', '风景.png', png.length]);
    check('with no tags and no pins', [listedImage.tags, listedImage.pinned, listedImage.favorite], [[], false, false]);

    await call('POST', '/folders', { path: '图片区' });
    const statsBeforeImage = (await call('GET', '')).payload.stats;
    const tagsBeforeImage = (await call('GET', '')).payload.tags;
    const inFolderImage = await upload('图标.png', png, '图片区');
    check('an upload can land in a folder', [inFolderImage.payload.note.path, inFolderImage.payload.note.folder], ['/图片区/图标.png', '图片区']);

    const afterImage = (await call('GET', '')).payload;
    check('pictures do not count as notes', afterImage.stats.notes, statsBeforeImage.notes);
    check('and add no tags', afterImage.tags, tagsBeforeImage);
    check(
      'the folder badge still counts notes only',
      afterImage.folders.find((folder) => folder.path === '图片区').count,
      0,
    );

    /* ---- serving the bytes --------------------------------------------- */
    const single = await call('GET', '/' + picture.payload.note.id);
    check('fetching a picture returns it without content', [single.status, single.payload.note.content, single.payload.note.kind], [200, '', 'image']);

    const served = await getBytes('/file?path=' + encodeURIComponent('/风景.png'));
    check('the picture is served by path', [served.status, served.type, served.body], [200, 'image/png', [...png]]);
    check('inline and under its own name', [/^inline;/.test(served.disposition), served.disposition.includes(encodeURIComponent('风景.png'))], [true, true]);

    const internal = await call('GET', '/file?path=' + encodeURIComponent('/.trash-files.json'));
    check('an internal manifest is not served', [internal.status, internal.payload.error.code], [400, 'invalid_path']);
    const missingFile = await call('GET', '/file?path=' + encodeURIComponent('/没有这个.png'));
    check('a missing file is a 404', [missingFile.status, missingFile.payload.error.code], [404, 'not_found']);
    const climbing = await call('GET', '/file?path=' + encodeURIComponent('/../../secret.txt'));
    check('a path that climbs out of the root is refused', [400, 404].includes(climbing.status), true);
    const asDirectory = await call('GET', '/file?path=' + encodeURIComponent('/图片区'));
    check('a directory is not a file', [asDirectory.status, asDirectory.payload.error.code], [400, 'not_a_file']);

    /* ---- renaming and moving a picture ---------------------------------- */
    const renamedImage = await call('PUT', '/' + picture.payload.note.id, { title: '外景' });
    check('a picture can be renamed', [renamedImage.status, renamedImage.payload.note.path, renamedImage.payload.note.title], [200, '/外景.png', '外景.png']);
    check('the file on disk follows the title', [onDisk('/外景.png'), onDisk('/风景.png')], [true, false]);
    check('still with the same bytes', [...readFileSync(fsPath('/外景.png'))], [...png]);

    const ignored = await call('PUT', '/' + renamedImage.payload.note.id, { content: '这不是文本', tags: ['标签'], pinned: true, favorite: true, color: '#fff' });
    check('content and note metadata on a picture are ignored', [ignored.status, ignored.payload.note.path, ignored.payload.note.tags, ignored.payload.note.pinned], [200, '/外景.png', [], false]);
    check('the bytes survived the ignored patch', [...readFileSync(fsPath('/外景.png'))], [...png]);

    const blanked = await call('PUT', '/' + renamedImage.payload.note.id, { title: '   ' });
    check('a blank title leaves a picture alone', blanked.payload.note.path, '/外景.png');

    await call('POST', '/folders', { path: '相册' });
    const movedImage = await call('PUT', '/' + renamedImage.payload.note.id, { folder: '相册' });
    check('a picture can be moved to another folder', [movedImage.status, movedImage.payload.note.path, movedImage.payload.note.folder], [200, '/相册/外景.png', '相册']);
    check('the moved file is on disk', [onDisk('/相册/外景.png'), onDisk('/外景.png')], [true, false]);

    // Renaming and moving in one request, where either half could land on a
    // file that is already there. Neither may overwrite what it finds.
    const png2 = Buffer.concat([png, Buffer.from([0x42])]);
    const bothAtOnce = await upload('合影.png', png);
    const combinedImage = await call('PUT', '/' + bothAtOnce.payload.note.id, { title: '合照', folder: '相册' });
    check('a picture can be renamed and moved at once', [combinedImage.status, combinedImage.payload.note.path], [200, '/相册/合照.png']);
    check('the file followed both changes', [onDisk('/相册/合照.png'), onDisk('/合影.png')], [true, false]);

    const sameNameA = await upload('同名.png', png);
    await upload('同名.png', png2, '图片区');
    const movedInto = await call('PUT', '/' + sameNameA.payload.note.id, { folder: '图片区' });
    check('a move that would collide takes the next free name', [movedInto.payload.note.path, onDisk('/同名.png')], ['/图片区/同名-2.png', false]);
    check('and leaves the file that was there alone', [...readFileSync(fsPath('/图片区/同名.png'))], [...png2]);

    await upload('照片.png', png, '图片区');
    const toRename = await upload('图.png', png2, '图片区');
    const renamedAndMoved = await call('PUT', '/' + toRename.payload.note.id, { title: '照片', folder: '' });
    check('a rename and move that would clash steps aside', [renamedAndMoved.payload.note.path, onDisk('/照片-2.png')], ['/照片-2.png', true]);
    check('without touching the sibling it stepped aside for', [...readFileSync(fsPath('/图片区/照片.png'))], [...png]);

    const downloaded = await getBytes('/' + movedImage.payload.note.id + '/download');
    check('a picture downloads as itself', [downloaded.status, downloaded.type, downloaded.body], [200, 'image/png', [...png]]);
    check('as an attachment under its own name', [/^attachment;/.test(downloaded.disposition), downloaded.disposition.includes(encodeURIComponent('外景.png'))], [true, true]);

    /* ---- the file trash -------------------------------------------------- */
    const removedImage = await call('DELETE', '/' + movedImage.payload.note.id);
    check('deleting a picture reports a trash move', [removedImage.status, removedImage.payload.trashed], [200, true]);
    check('the file left its folder for the trash', [onDisk('/相册/外景.png'), onDisk('/_trash/外景.png')], [false, true]);
    check('and is recorded in the file manifest', readFileSync(fsPath('/.trash-files.json'), 'utf8').includes('"/_trash/外景.png"'), true);

    const trashedImage = (await call('GET', '/trash')).payload.notes.find((note) => note.path === '/_trash/外景.png');
    check('the trash lists it as a picture', [trashedImage.kind, trashedImage.title, trashedImage.originFolder], ['image', '外景.png', '相册']);
    check('with the moment it was deleted', typeof trashedImage.deletedAt === 'string' && trashedImage.deletedAt.length > 0, true);

    // The trash lists the file by where it sits now, so that is the id the
    // interface has in hand when the user presses restore.
    const restoredImage = await call('POST', '/' + trashedImage.id + '/restore');
    check('a picture comes back to where it was', [restoredImage.status, restoredImage.payload.note.path, restoredImage.payload.note.folder], [200, '/相册/外景.png', '相册']);
    check('with its old id and its bytes', [restoredImage.payload.note.id, [...readFileSync(fsPath('/相册/外景.png'))]], [movedImage.payload.note.id, [...png]]);
    check('and the trash forgets it', [onDisk('/_trash/外景.png'), onDisk('/.trash-files.json')], [false, false]);

    // The name it had is taken again by the time it comes back.
    const clashing = await upload('冲突.png', png);
    await call('DELETE', '/' + clashing.payload.note.id);
    await upload('冲突.png', png);
    const clashingTrash = (await call('GET', '/trash')).payload.notes.find((note) => note.title === '冲突.png');
    const restoredClash = await call('POST', '/' + clashingTrash.id + '/restore');
    check('restoring steps aside for a name that is taken again', [restoredClash.payload.note.path, onDisk('/冲突.png'), onDisk('/冲突-2.png')], ['/冲突-2.png', true, true]);

    // A note's own trip through the trash is unchanged: front matter, not a manifest.
    const noteForTrash = await call('POST', '', { title: '回收站笔记', content: '正文' });
    const removedNote = await call('DELETE', '/' + noteForTrash.payload.note.id);
    const trashedNote = (await call('GET', '/trash')).payload.notes.find((note) => note.id === noteForTrash.payload.note.id);
    check('a note still goes to the trash as a note', [removedNote.payload.trashed, trashedNote.kind, trashedNote.originFolder], [true, 'note', '']);
    check('its front matter remembers the deletion', readFileSync(fsPath(trashedNote.path), 'utf8').includes('deletedAt:'), true);
    const backNote = await call('POST', '/' + noteForTrash.payload.note.id + '/restore');
    check('and it comes back with its body', [backNote.status, backNote.payload.note.title, backNote.payload.note.content.trim()], [200, '回收站笔记', '正文']);

    // A trashed file can also be thrown away on its own.
    const toPurge = await upload('永久删除.png', png);
    await call('DELETE', '/' + toPurge.payload.note.id);
    const forGood = (await call('GET', '/trash')).payload.notes.find((note) => note.title === '永久删除.png');
    const purged = await call('DELETE', '/' + forGood.id + '?permanent=true');
    check('a trashed file can be deleted for good', [purged.status, purged.payload.trashed, onDisk('/_trash/永久删除.png'), onDisk('/.trash-files.json')], [200, false, false, false]);

    // Emptying the trash has to empty the manifest with it.
    const toEmpty = await upload('待清空.png', png);
    await call('DELETE', '/' + toEmpty.payload.note.id);
    const emptied = await call('POST', '/trash/empty');
    check('emptying the trash removes manifest files too', [emptied.status, onDisk('/_trash/待清空.png'), onDisk('/.trash-files.json')], [200, false, false]);

    // Two files of the same name, one in a folder and one at the root: the
    // trash has to hold both and remember where each came from.
    const sameNameInFolder = await upload('重名.png', png, '相册');
    const sameNameAtRoot = await upload('重名.png', png2);
    await call('DELETE', '/' + sameNameInFolder.payload.note.id);
    await call('DELETE', '/' + sameNameAtRoot.payload.note.id);
    const bothTrashed = (await call('GET', '/trash')).payload.notes.filter((note) => /^重名/.test(note.title));
    check('the trash holds both files of the same name', [bothTrashed.length, onDisk('/_trash/重名.png')], [2, true]);
    check('and remembers where each came from', bothTrashed.map((note) => note.originFolder).sort(), ['', '相册']);

    const keptName = bothTrashed.find((note) => note.path === '/_trash/重名.png');
    const renamedInTrash = bothTrashed.find((note) => note.path !== '/_trash/重名.png');
    const backFromTrash = await call('POST', '/' + keptName.id + '/restore');
    check('the file that kept its name comes straight back', [backFromTrash.payload.note.path, backFromTrash.payload.note.folder], ['/相册/重名.png', '相册']);
    const backFromSuffix = await call('POST', '/' + renamedInTrash.id + '/restore');
    check('the suffixed one returns to its own folder', [backFromSuffix.payload.note.path.startsWith('/重名'), backFromSuffix.payload.note.folder], [true, '']);
    check('with its own bytes', [...readFileSync(fsPath(backFromSuffix.payload.note.path))], [...png2]);
  } finally {
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections?.();
    await closed;
    rmSync(root, { recursive: true, force: true });
  }
}

/* -------------------------------------------------------------------------- */
/* The driver primitives behind a move                                         */
/* -------------------------------------------------------------------------- */
{
  const root = mkdtempSync(path.join(os.tmpdir(), 'nm-driver-move-'));
  try {
    const local = new LocalStorageDriver(root);
    await local.mkdir('/one');
    await local.mkdir('/two');
    await local.write('/one/a.md', 'a');
    await local.move('/one/a.md', '/two');
    check('a local move carries the file over', [existsSync(path.join(root, 'two', 'a.md')), existsSync(path.join(root, 'one', 'a.md'))], [true, false]);

    await local.write('/one/b.md', 'b');
    await local.write('/two/b.md', 'b2');
    const clash = await local.move('/one/b.md', '/two').then(() => 'moved', (err) => [err.status, err.code]);
    check('a local move refuses a taken destination', clash, [409, 'exists']);
    check('and leaves the destination as it was', readFileSync(path.join(root, 'two', 'b.md'), 'utf8'), 'b2');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/* -------------------------------------------------------------------------- */
/* The OpenList side of a move                                                 */
/* -------------------------------------------------------------------------- */
{
  // There is no OpenList to move anything on, so the request the driver builds
  // is asserted directly: a move is "the entry, from its parent, to the target".
  const calls = [];
  const client = { move: async (srcDir, dstDir, names) => calls.push([srcDir, dstDir, names]) };
  const openlist = new OpenListStorageDriver(client, '/notes');
  await openlist.move('/a/b.md', '/c');
  await openlist.move('/a/b', '/');
  check('an OpenList move names the parent and the entry', calls[0], ['/notes/a', '/notes/c', ['b.md']]);
  check('and the OpenList root is a valid destination', calls[1], ['/notes/a', '/notes', ['b']]);
}

/* -------------------------------------------------------------------------- */
/* The driver primitive behind serving a picture                               */
/* -------------------------------------------------------------------------- */
{
  const root = mkdtempSync(path.join(os.tmpdir(), 'nm-driver-bytes-'));
  try {
    const local = new LocalStorageDriver(root);
    // Bytes a text round trip would not survive: 0x00, an invalid UTF-8 byte
    // and a lone continuation byte.
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x80, 0x7f]);
    await local.writeBinary('/a.png', bytes);
    check('a local read returns the exact bytes', [...(await local.readBinary('/a.png'))], [...bytes]);
    check('and reading it twice is the same', [...(await local.readBinary('/a.png'))], [...bytes]);

    const missing = await local.readBinary('/nope.png').then(() => 'read', (err) => [err.status, err.code]);
    check('a missing file is a 404', missing, [404, 'not_found']);
    const directory = await local.readBinary('/').then(() => 'read', (err) => [err.status, err.code]);
    check('a directory is not a file', directory, [400, 'not_a_file']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/* -------------------------------------------------------------------------- */
/* The OpenList side of reading bytes                                          */
/* -------------------------------------------------------------------------- */
{
  // No OpenList either: the two requests the driver can make are asserted
  // directly, including the fallback that makes a blocked raw_url harmless.
  const resolved = [];
  const openlist = new OpenListStorageDriver(
    {
      readBytes: async (filePath) => {
        resolved.push(filePath);
        return new Uint8Array([1, 2, 3]);
      },
      readBytesViaProxy: async () => new Uint8Array([4]),
    },
    '/notes',
  );
  check('an OpenList read returns bytes', [...(await openlist.readBinary('/a/b.png'))], [1, 2, 3]);
  check('and resolves the path inside the configured root', resolved[0], '/notes/a/b.png');

  const proxied = [];
  const blocked = new OpenListStorageDriver(
    {
      readBytes: async () => {
        throw new Error('raw_url is not reachable');
      },
      readBytesViaProxy: async (filePath) => {
        proxied.push(filePath);
        return new Uint8Array([9, 8]);
      },
    },
    '/notes',
  );
  check('a blocked direct link falls back to the proxy', [...(await blocked.readBinary('/a.png'))], [9, 8]);
  check('and the proxy is asked for the same file', proxied[0], '/notes/a.png');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
