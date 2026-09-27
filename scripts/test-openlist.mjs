#!/usr/bin/env node
/**
 * End-to-end tests for the OpenList driver, against a fake that behaves the way
 * the real server does (scripts/fake-openlist.mjs names the handler each rule
 * comes from).
 *
 *   node scripts/test-openlist.mjs        (run "npm run build:server" first)
 *
 * Why a fake rather than the local disk: the two things that go wrong on
 * OpenList are exactly the ones a local filesystem hides - a write is an
 * *upload*, not an edit, and `/api/fs/move` answers before the move has
 * happened. Both are reproduced here, so a regression fails a test instead of
 * somebody's file.
 */
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { startFakeOpenList } from './fake-openlist.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'server', 'dist');
const distUrl = (...parts) => `file://${path.join(DIST, ...parts).replace(/\\/g, '/')}`;

if (!fs.existsSync(path.join(DIST, 'storage', 'openlist.js'))) {
  console.error('server/dist is missing - run "npm run build:server" first');
  process.exit(1);
}

const express = (await import('express')).default;
const { OpenListClient } = await import(distUrl('integrations', 'openlist', 'client.js'));
const { OpenListStorageDriver } = await import(distUrl('storage', 'openlist.js'));
const { NotesRepository } = await import(distUrl('notes', 'repository.js'));
const { notesRoutes } = await import(distUrl('http', 'routes', 'notes.js'));

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

console.log('');
console.log('openlist: renaming and moving real files');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-openlist-'));
// The move is a background task on the real server, so it is one here too:
// nothing in this file would notice a driver that does not wait for it.
const fake = await startFakeOpenList({ root, asyncMove: true, moveDelayMs: 700 });
let server;
try {
  // Mounted on a throwaway app, exactly like scripts/test-server.mjs: every
  // assertion goes through the handlers, body parsing and error mapping the
  // server really uses.
  const client = new OpenListClient({ baseUrl: fake.url, token: 'test-token' });
  const driver = new OpenListStorageDriver(client, '/notes');
  const notes = new NotesRepository({
    resolve: async () => ({ driver, kind: 'openlist', displayRoot: '/notes', degraded: false, detail: 'test' }),
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

  server = app.listen(0, '127.0.0.1');
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

  const sent = (p) => fake.requests.filter((request) => request.path === p);
  const bodies = (p) => sent(p).map((request) => request.body);
  const listedNote = async (id) => (await call('GET', '')).payload.notes.find((note) => note.id === id);
  const trashFiles = () => fake.files().filter((file) => file.includes('/_trash/'));
  /** The requests that change the tree, in the order the app sent them. */
  const mutations = () =>
    fake.requests
      .filter((request) => ['/api/fs/rename', '/api/fs/move', '/api/fs/put', '/api/fs/remove'].includes(request.path))
      .map((request) => request.path);
  // The backend's own files, for the things a JSON API cannot show: file
  // identity (birthtime survives a rename) and exact bytes.
  const fakePath = (p) => path.join(fake.root, ...p.split('/').filter(Boolean));
  const bytesOf = (p) => fs.readFileSync(fakePath(p));
  const statOf = (p) => fs.statSync(fakePath(p));
  /** Uploads of a file's own bytes; the trash manifest is written the same way. */
  const contentWrites = () =>
    sent('/api/fs/put').filter((request) => request.filePath !== '/notes/.trash-files.json').map((request) => request.filePath);

  // Raw-body uploads, the way the browser sends them.
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

  /* ---- the fake itself -------------------------------------------------- */
  check('the fake starts empty', fake.files(), []);
  const mkdirTwice = await client.mkdir('/notes/照片').then(() => 'accepted', (err) => err.message);
  check('mkdir on a folder that is there is accepted, as op.MakeDir does', mkdirTwice, 'accepted');
  const putInMissingFolder = await client
    .put('/notes/没有的目录/a.md', 'x')
    .then(() => 'accepted', (err) => err.message);
  check('a put into a folder that is missing fails, as PutDirectly does', putInMissingFolder, 'parent directory not found');

  /* ---- renaming a note is a rename, not an upload ----------------------- */
  const created = await call('POST', '', { title: '旧名字', content: '正文' });
  check('a note is created through OpenList', [created.status, created.payload.note.path], [201, '/旧名字.md']);
  check('and lands as a real file', fake.files(), ['/notes/旧名字.md']);

  const bornBefore = fake.stat('/notes/旧名字.md').birthtimeMs;
  fake.reset();
  const renamed = await call('PUT', '/' + created.payload.note.id, { title: '新名字' });
  check('a title change reports the new path', [renamed.status, renamed.payload.note.path], [200, '/新名字.md']);
  check('OpenList has the new name and not the old one', [fake.has('/notes/新名字.md'), fake.has('/notes/旧名字.md')], [true, false]);
  check('the file was renamed, not uploaded again', fake.stat('/notes/新名字.md').birthtimeMs, bornBefore);
  check('the app asked for a rename', bodies('/api/fs/rename'), [{ path: '/notes/旧名字.md', name: '新名字.md' }]);
  check('the content went to the file that was renamed', sent('/api/fs/put').map((request) => request.filePath), ['/notes/新名字.md']);
  check('nothing was removed to fake the rename', sent('/api/fs/remove').length, 0);
  check('the listing agrees straight away', (await listedNote(created.payload.note.id)).path, '/新名字.md');

  /* ---- the same inside a folder ----------------------------------------- */
  await call('POST', '/folders', { path: '档案' });
  const inFolder = await call('POST', '', { title: 'old', content: '正文', folder: '档案' });
  check('a note can live in a folder', inFolder.payload.note.path, '/档案/old.md');

  fake.reset();
  const renamedInside = await call('PUT', '/' + inFolder.payload.note.id, { title: 'new' });
  check('renaming inside a folder stays inside it', [renamedInside.payload.note.path, renamedInside.payload.note.folder], ['/档案/new.md', '档案']);
  check('OpenList has the new name there', [fake.has('/notes/档案/new.md'), fake.has('/notes/档案/old.md')], [true, false]);
  check('and the rename never left the folder', bodies('/api/fs/rename'), [{ path: '/notes/档案/old.md', name: 'new.md' }]);

  /* ---- a name that is already taken ------------------------------------- */
  await call('POST', '', { title: '占用', content: '别人的正文' });
  const mine = await call('POST', '', { title: '要改名的', content: '我的正文' });
  fake.reset();
  const collided = await call('PUT', '/' + mine.payload.note.id, { title: '占用' });
  check('a taken name gets a free one', collided.payload.note.path, '/占用-2.md');
  check('both files are on OpenList', [fake.has('/notes/占用.md'), fake.has('/notes/占用-2.md')], [true, true]);
  check('the note that was there is untouched', fake.read('/notes/占用.md').includes('别人的正文'), true);
  check('and the renamed one kept its own body', fake.read('/notes/占用-2.md').includes('我的正文'), true);
  check('the rename went to the free name', bodies('/api/fs/rename'), [{ path: '/notes/要改名的.md', name: '占用-2.md' }]);

  /* ---- moving a note: the task has to be waited for --------------------- */
  await call('POST', '/folders', { path: '目标' });
  fake.reset();
  const before = Date.now();
  const movedNote = await call('PUT', '/' + created.payload.note.id, { folder: '目标' });
  const elapsed = Date.now() - before;
  check('the move reports the new path', [movedNote.status, movedNote.payload.note.path], [200, '/目标/新名字.md']);
  check(
    'OpenList had finished when the reply was sent',
    [fake.has('/notes/目标/新名字.md'), fake.has('/notes/新名字.md')],
    [true, false],
  );
  check('the app used the move endpoint', sent('/api/fs/move').length, 1);
  check('and waited for the background task to run', elapsed >= 690, true);
  check('the listing agrees with OpenList', (await listedNote(created.payload.note.id)).path, '/目标/新名字.md');

  /* ---- moving a folder -------------------------------------------------- */
  await call('POST', '/folders', { path: '资料' });
  const inArchive = await call('POST', '', { title: 'x', content: '正文', folder: '资料' });
  fake.reset();
  const renamedFolder = await call('POST', '/folders/rename', { path: '资料', name: '档案2' });
  check('a folder is renamed in OpenList', [renamedFolder.status, fake.has('/notes/档案2'), fake.has('/notes/资料')], [200, true, false]);
  check('and its note came with it', [fake.has('/notes/档案2/x.md'), inArchive.payload.note.path], [true, '/资料/x.md']);
  check('the folder rename is a plain rename', bodies('/api/fs/rename'), [{ path: '/notes/资料', name: '档案2' }]);

  fake.reset();
  const movedFolder = await call('POST', '/folders/move', { path: '档案2', target: '目标' });
  check('a folder move is reported', [movedFolder.status, movedFolder.payload.path], [200, '目标/档案2']);
  check('and it had landed before the reply', [fake.has('/notes/目标/档案2/x.md'), fake.has('/notes/档案2')], [true, false]);
  check('the listing shows the note under the new folder', (await listedNote(inArchive.payload.note.id)).path, '/目标/档案2/x.md');

  /* ---- a move that never lands ------------------------------------------ */
  // The other half of waiting: a task that never runs has to be reported. The
  // wait is shortened here so the test does not sit through the real timeout.
  const stuck = new OpenListStorageDriver(
    { move: async () => {}, exists: async () => false },
    '/notes',
    'stuck',
    { pollMs: 25, timeoutMs: 200 },
  );
  const stuckResult = await stuck
    .move('/a.md', '/b')
    .then(() => 'resolved', (err) => [err.status, err.code, /仍在后台搬运/.test(err.message)]);
  check('a move that never lands is reported, not assumed', stuckResult, [504, 'openlist_move_pending', true]);

  /* ---- the trash and back ----------------------------------------------- */
  const notePath = '/目标/新名字.md';
  const bornBeforeTrash = statOf('/notes' + notePath).birthtimeMs;
  fake.reset();
  const removed = await call('DELETE', '/' + created.payload.note.id);
  check('deleting moves the note to the trash', [removed.status, removed.payload.trashed], [200, true]);
  check('OpenList shows one file in _trash', trashFiles().length, 1);
  check('and none at the old path', fake.has('/notes' + notePath), false);

  const trashPath = trashFiles()[0];
  const trashBase = trashPath.split('/').pop();
  check('the note was renamed in place, then moved', [bodies('/api/fs/rename'), bodies('/api/fs/move')], [
    [{ path: '/notes' + notePath, name: trashBase }],
    [{ src_dir: '/notes/目标', dst_dir: '/notes/_trash', names: [trashBase] }],
  ]);
  // The whole point: a copy-and-delete would show up here as put + remove.
  check('and nothing was copied or deleted to fake it', mutations(), ['/api/fs/rename', '/api/fs/move', '/api/fs/put']);
  check('the write went to the file that had already moved', sent('/api/fs/put').map((request) => request.filePath), [trashPath]);
  check('the trashed note is the same file, not a fresh upload', statOf(trashPath).birthtimeMs, bornBeforeTrash);

  const trashedNote = (await call('GET', '/trash')).payload.notes.find((note) => note.id === created.payload.note.id);
  check('the trash lists it, and where it came from', [trashedNote.kind, trashedNote.originFolder, trashedNote.path], ['note', '目标', '/_trash/' + trashBase]);
  check('the workspace does not', (await call('GET', '')).payload.notes.some((note) => note.id === created.payload.note.id), false);

  fake.reset();
  const restored = await call('POST', '/' + created.payload.note.id + '/restore');
  check('restoring puts it back in its folder under its own name', [restored.status, restored.payload.note.path, restored.payload.note.folder], [200, notePath, '目标']);
  check('by renaming inside the trash, then moving it home', [bodies('/api/fs/rename'), bodies('/api/fs/move')], [
    [{ path: trashPath, name: '新名字.md' }],
    [{ src_dir: '/notes/_trash', dst_dir: '/notes/目标', names: ['新名字.md'] }],
  ]);
  check('never as a copy and a delete', mutations(), ['/api/fs/rename', '/api/fs/move', '/api/fs/put']);
  check('the file is back and the trash is empty', [fake.has('/notes' + restored.payload.note.path), trashFiles().length], [true, 0]);
  check('still the same file after two relocates', statOf('/notes' + restored.payload.note.path).birthtimeMs, bornBeforeTrash);
  check('the deletion marks are gone', [restored.payload.note.deletedAt, restored.payload.note.originFolder], [null, null]);
  check('with its body intact', fake.read('/notes' + restored.payload.note.path).includes('正文'), true);
  check('and it is listed again', (await listedNote(created.payload.note.id)).path, restored.payload.note.path);

  /* ---- a picture through the trash -------------------------------------- */
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
  const png2 = Buffer.concat([png, Buffer.from([0x42])]);
  const picture = await upload('照片.png', png, '目标');
  check('a picture uploads as a file', [picture.status, picture.payload.note.path, picture.payload.note.kind], [201, '/目标/照片.png', 'image']);
  const bornPicture = statOf('/notes/目标/照片.png').birthtimeMs;

  fake.reset();
  const removedPicture = await call('DELETE', '/' + picture.payload.note.id);
  check('a picture goes to the trash', [removedPicture.status, removedPicture.payload.trashed], [200, true]);
  check('by moving it, with no upload of the file itself', [sent('/api/fs/move').length, contentWrites()], [1, []]);
  check('the manifest remembers where it came from', (() => {
    const entry = JSON.parse(fake.read('/notes/.trash-files.json'))[0];
    return [entry.trashPath, entry.originalPath, typeof entry.deletedAt];
  })(), ['/_trash/照片.png', '/目标/照片.png', 'string']);
  check('and the file is the same one, byte for byte', [statOf('/notes/_trash/照片.png').birthtimeMs, [...bytesOf('/notes/_trash/照片.png')]], [bornPicture, [...png]]);

  const pictureTrashId = (await call('GET', '/trash')).payload.notes.find((note) => note.path === '/_trash/照片.png').id;
  fake.reset();
  const restoredPicture = await call('POST', '/' + pictureTrashId + '/restore');
  check('a picture comes back where it was', [restoredPicture.status, restoredPicture.payload.note.path], [200, '/目标/照片.png']);
  check('by moving it back, not by uploading a copy', [sent('/api/fs/move').length, contentWrites()], [1, []]);
  check('the manifest goes with it', [fake.has('/notes/_trash/照片.png'), fake.has('/notes/.trash-files.json')], [false, false]);
  check('byte for byte the same picture', [statOf('/notes/目标/照片.png').birthtimeMs, [...bytesOf('/notes/目标/照片.png')]], [bornPicture, [...png]]);

  /* ---- two files of one name in the trash ------------------------------- */
  const clashA = await upload('重名.png', png, '目标');
  const clashB = await upload('重名.png', png2);
  check('two pictures of the same name, in two folders', [clashA.payload.note.path, clashB.payload.note.path], ['/目标/重名.png', '/重名.png']);

  fake.reset();
  await call('DELETE', '/' + clashA.payload.note.id);
  check('the first goes in under its own name', [sent('/api/fs/move').length, trashFiles().includes('/notes/_trash/重名.png')], [1, true]);

  fake.reset();
  await call('DELETE', '/' + clashB.payload.note.id);
  const clashTrash = trashFiles().sort();
  const renamedOne = clashTrash.find((file) => file !== '/notes/_trash/重名.png');
  check('the second takes a free name instead', [clashTrash.length, /^\/notes\/_trash\/重名-[0-9a-f]{6}\.png$/.test(renamedOne)], [2, true]);
  check('and it renamed before it moved', mutations().filter((p) => p !== '/api/fs/put'), ['/api/fs/rename', '/api/fs/move']);
  check('the file that was already there is untouched', [...bytesOf('/notes/_trash/重名.png')], [...png]);
  check('and the second kept its own bytes', [...bytesOf(renamedOne)], [...png2]);
  check('the manifest holds both rows', JSON.parse(fake.read('/notes/.trash-files.json')).length, 2);
  check('neither original is left behind', [fake.has('/notes/目标/重名.png'), fake.has('/notes/重名.png')], [false, false]);
} finally {
  if (server) {
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections?.();
    await closed;
  }
  await fake.close();
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
