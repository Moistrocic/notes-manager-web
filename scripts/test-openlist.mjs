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
const { StorageManager } = await import(distUrl('storage', 'manager.js'));
const { NotesRepository } = await import(distUrl('notes', 'repository.js'));
const { notesRoutes } = await import(distUrl('http', 'routes', 'notes.js'));
const { blogRoutes } = await import(distUrl('http', 'routes', 'blog.js'));

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
  // The blog reads as OpenList's guest: no token at all, which is the account
  // OpenList answers anonymous requests with.
  const guestDriver = new OpenListStorageDriver(new OpenListClient({ baseUrl: fake.url }), '/notes');
  const notes = new NotesRepository({
    resolve: async () => ({ driver, kind: 'openlist', displayRoot: '/notes', degraded: false, detail: 'test' }),
    resolveGuest: async () => ({ driver: guestDriver, kind: 'openlist', displayRoot: '/notes', degraded: false, detail: 'test' }),
  });
  const session = {
    username: 'admin',
    provider: 'local',
    role: 'admin',
    guest: false,
    permissions: { write: true, rename: true, move: true, remove: true },
  };
  // What the app's settings say while this run happens. The guest switch is
  // only ever consulted by the panel; the blog reads its own flag.
  const siteSettings = { blog: { enabled: true }, guest: { enabled: true } };
  // A request with no cookie at all, for the public pages.
  let anonymous = false;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = anonymous ? null : session;
    next();
  });
  app.use('/api/notes', notesRoutes({ notes }));
  app.use('/api/blog', blogRoutes({ notes, settings: { effective: () => structuredClone(siteSettings) } }));

  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/notes';
  const blogBase = 'http://127.0.0.1:' + server.address().port + '/api/blog';

  const callAt = async (root, method, url, body) => {
    const response = await fetch(root + url, {
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
  const call = (method, url, body) => callAt(base, method, url, body);
  const blogCall = (method, url, body) => callAt(blogBase, method, url, body);

  // A response whose body is the bytes themselves, not JSON.
  const blogBytes = async (url) => {
    const response = await fetch(blogBase + url);
    const body = Buffer.from(await response.arrayBuffer());
    return { status: response.status, type: response.headers.get('content-type'), body: [...body] };
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

  /* ---- the blog does not care about guest browsing ---------------------- */
  // The switch is off and the request carries no session at all: the panel
  // needs an account, the site's front page is for everyone.
  const published = await call('PUT', '/' + created.payload.note.id, {
    blog: true,
    content: '![图](./照片.png)\n\n正文\n',
  });
  check('a note can be published with a picture in it', [published.status, published.payload.note.blog, typeof published.payload.note.blogAt], [200, true, 'string']);

  siteSettings.guest.enabled = false;
  anonymous = true;
  try {
    const publicIndex = await blogCall('GET', '');
    check('an anonymous reader still gets the cards with guest browsing off', [
      publicIndex.status,
      publicIndex.payload.enabled,
      (publicIndex.payload.posts ?? []).map((post) => post.id),
    ], [200, true, [created.payload.note.id]]);
    const publicPost = await blogCall('GET', '/post?path=' + encodeURIComponent(published.payload.note.path));
    check('and still reads the post', [publicPost.status, publicPost.payload.post.content.trim()], [200, '![图](./照片.png)\n\n正文']);
    const publicFile = await blogBytes('/file?path=' + encodeURIComponent('/目标/照片.png'));
    check('and still gets the picture it refers to', [publicFile.status, publicFile.body], [200, [...png]]);
    const anonymousWrite = await call('PUT', '/' + created.payload.note.id, { title: '不允许' });
    check('while the panel still wants an account', [anonymousWrite.status, anonymousWrite.payload.error.code], [401, 'unauthenticated']);
  } finally {
    anonymous = false;
  }

  /* ---- a token account jailed to a base path ---------------------------- */
  // OpenList joins every request path onto the account's own base path
  // (user.JoinPath -> JoinBasePath), and the public blog reads with the *service
  // token*. So an absolute OPENLIST_ROOT of /public/Notes has to be asked for as
  // /Notes: asking for /public/Notes makes OpenList look in /public/public/Notes
  // and answer "object not found" - which is what the user saw on the blog.
  const jailRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-openlist-jail-'));
  // Both accounts are jailed to /public here: the token's (the panel) and
  // OpenList's guest (the blog, which reads without a token).
  const jail = await startFakeOpenList({ root: jailRoot, basePath: '/public', guestBasePath: '/public' });
  let jailServer;
  try {
    const jailSettings = (root, token = 'jail-token') => ({
      effective: () => ({
        storage: {
          driver: 'openlist',
          openlist: { url: jail.url, token, root, perUser: false, timeoutMs: 2000 },
          local: { root: jailRoot },
        },
      }),
    });

    // The notes really are in <fake root>/public/Notes - the account sees them
    // as /Notes.
    fs.mkdirSync(path.join(jailRoot, 'public', 'Notes'), { recursive: true });
    fs.writeFileSync(
      path.join(jailRoot, 'public', 'Notes', '越狱笔记.md'),
      '---\nid: jailed\nblog: true\nblogAt: "2024-01-01T00:00:00.000Z"\n---\n\n正文\n',
      'utf8',
    );

    const jailStorage = new StorageManager(jailSettings('/public/Notes'), jailRoot);
    const jailNotes = new NotesRepository(jailStorage);
    const jailApp = express();
    jailApp.use(express.json());
    // The panel half of the report: a local administrator session, which has no
    // OpenList base path of its own and reads with the service token.
    jailApp.use((req, _res, next) => {
      req.session = {
        username: 'admin',
        provider: 'local',
        role: 'admin',
        guest: false,
        permissions: { write: true, rename: true, move: true, remove: true },
      };
      next();
    });
    jailApp.use('/api/notes', notesRoutes({ notes: jailNotes }));
    jailApp.use('/api/blog', blogRoutes({ notes: jailNotes, settings: { effective: () => ({ blog: { enabled: true } }) } }));
    jailServer = jailApp.listen(0, '127.0.0.1');
    await new Promise((resolve) => jailServer.once('listening', resolve));
    const jailOrigin = 'http://127.0.0.1:' + jailServer.address().port;

    // Read defensively: a regression here answers with an error payload, and a
    // clean FAIL says far more than a TypeError half way down the file.
    const jailFetch = async (url) => {
      const response = await fetch(jailOrigin + url);
      return { status: response.status, payload: await response.json() };
    };

    const jailList = await jailFetch('/api/notes');
    check('a jailed account can read a root inside its own jail', [jailList.status, (jailList.payload.notes ?? []).map((note) => note.path)], [200, ['/越狱笔记.md']]);
    const listPaths = jail.requests.filter((request) => request.path === '/api/fs/list').map((request) => request.body.path);
    check('and the path it asked for had the base path stripped', listPaths.includes('/Notes'), true);
    check('never the absolute root, which OpenList would join twice', listPaths.includes('/public/Notes'), false);

    const jailBlog = await jailFetch('/api/blog');
    check('the blog lists the card read as the jailed guest', [jailBlog.status, jailBlog.payload.enabled, (jailBlog.payload.posts ?? []).map((post) => post.title)], [200, true, ['越狱笔记']]);
    const guestListPaths = jail.requests.filter((request) => request.path === '/api/fs/list' && !request.authorized).map((request) => request.body.path);
    check('and the guest read had the base path stripped too', [guestListPaths.includes('/Notes'), guestListPaths.includes('/public/Notes')], [true, false]);
    const jailPost = await jailFetch('/api/blog/post?path=' + encodeURIComponent('/越狱笔记.md'));
    check('and serves the post itself', [jailPost.status, jailPost.payload.post?.title, jailPost.payload.post?.content.trim()], [200, '越狱笔记', '正文']);

    // A session that signed in through OpenList carries its own base path - that
    // is why the panel worked before this existed - and it still wins.
    const openlistUser = { username: 'tester', provider: 'openlist', openlistToken: 'jail-token', openlistBasePath: '/public' };
    check('a session that knows its own base path resolves the same way', (await jailStorage.resolve(openlistUser)).driver.root, '/Notes');

    // Asked once per token, not once per request.
    jail.reset();
    const cachedStorage = new StorageManager(jailSettings('/public/Notes'), jailRoot);
    await cachedStorage.resolve(null);
    await cachedStorage.resolve(null);
    check('the account is asked for its base path once', jail.requests.filter((request) => request.path === '/api/me').length, 1);
    await new StorageManager(jailSettings('/public/Notes', 'another-token'), jailRoot).resolve(null);
    check('and a different token is asked about again', jail.requests.filter((request) => request.path === '/api/me').length, 2);

    // A root the account cannot see is still refused.
    check(
      'a root outside the account base path is still refused',
      await new StorageManager(jailSettings('/other'), jailRoot).resolve(null).then(
        () => 'resolved',
        (err) => [err.status, err.code],
      ),
      [403, 'openlist_forbidden'],
    );

    // An account that cannot be asked (an old build, a token that cannot read
    // itself) falls back to "/" - what the app assumed before this existed - and
    // that is not a new failure.
    const muteJail = await startFakeOpenList({ root: jailRoot, basePath: '/public', meUnauthorized: true });
    try {
      const muteStorage = new StorageManager(
        {
          effective: () => ({
            storage: {
              driver: 'openlist',
              openlist: { url: muteJail.url, token: 'jail-token', root: '/public/Notes', perUser: false, timeoutMs: 2000 },
              local: { root: jailRoot },
            },
          }),
        },
        jailRoot,
      );
      check(
        'an account that cannot be asked falls back to the absolute root, without failing',
        await muteStorage.resolve(null).then(
          (resolved) => resolved.driver.root,
          (err) => `rejected:${err.code}`,
        ),
        '/public/Notes',
      );
    } finally {
      await muteJail.close();
    }
  } finally {
    if (jailServer) {
      const closed = new Promise((resolve) => jailServer.close(resolve));
      jailServer.closeAllConnections?.();
      await closed;
    }
    await jail.close();
    fs.rmSync(jailRoot, { recursive: true, force: true });
  }

  /* ---- the blog reads as the guest, not as the service token ------------ */
  // The user's case: the service token's account cannot see the notes, but
  // OpenList's guest can. The blog asks as the guest, so it still has cards -
  // while the panel, which does use the token, sees nothing (and says so by
  // being empty rather than by lying about the blog).
  const guestRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nm-openlist-guest-'));
  // The token account is limited to /private (it cannot even reach the notes),
  // while OpenList's guest can see /public - where the notes are.
  const guestFake = await startFakeOpenList({ root: guestRoot, basePath: '/private', guestBasePath: '/public' });
  let guestServer;
  try {
    fs.mkdirSync(path.join(guestRoot, 'public', 'Notes'), { recursive: true });
    fs.writeFileSync(
      path.join(guestRoot, 'public', 'Notes', '访客可见.md'),
      '---\nid: guestpost\nblog: true\nblogAt: "2024-02-02T00:00:00.000Z"\n---\n\n访客正文\n',
      'utf8',
    );

    /** One app over one fake: real StorageManager, real routes. */
    const buildApp = async (fake) => {
      const storage = new StorageManager(
        {
          effective: () => ({
            storage: {
              driver: 'openlist',
              openlist: { url: fake.url, token: 'service-token', root: '/public/Notes', perUser: false, timeoutMs: 2000 },
              local: { root: guestRoot },
            },
          }),
        },
        guestRoot,
      );
      const repo = new NotesRepository(storage);
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.session = {
          username: 'admin',
          provider: 'local',
          role: 'admin',
          guest: false,
          permissions: { write: true, rename: true, move: true, remove: true },
        };
        next();
      });
      app.use('/api/notes', notesRoutes({ notes: repo }));
      app.use(
        '/api/blog',
        blogRoutes({
          notes: repo,
          // The panel switch is off throughout: the blog never asks about it.
          settings: { effective: () => ({ blog: { enabled: true }, guest: { enabled: false } }) },
        }),
      );
      const server = app.listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      const origin = 'http://127.0.0.1:' + server.address().port;
      return {
        getJson: async (url) => {
          const response = await fetch(origin + url);
          return { status: response.status, payload: await response.json() };
        },
        close: () =>
          new Promise((resolve) => {
            server.closeAllConnections?.();
            server.close(resolve);
          }),
      };
    };

    const app = await buildApp(guestFake);
    try {
      const panel = await app.getJson('/api/notes');
      check('the panel cannot use that root with the token account', [panel.status, panel.payload.error?.code], [403, 'openlist_forbidden']);
      const blog = await app.getJson('/api/blog');
      check('the blog still has the card, because it reads as the guest', [blog.status, (blog.payload.posts ?? []).map((post) => post.title)], [200, ['访客可见']]);
      const post = await app.getJson('/api/blog/post?path=' + encodeURIComponent('/访客可见.md'));
      check('and serves the post', [post.status, post.payload.post?.content.trim()], [200, '访客正文']);

      // Who asked as whom: the panel's lookup carried the token, the blog's did
      // not - and only the guest ever got to list a folder.
      const meCalls = guestFake.requests.filter((request) => request.path === '/api/me');
      check('the panel asked as the token account', meCalls.some((request) => request.authorized), true);
      check('and the blog asked as the guest, with no token at all', meCalls.some((request) => !request.authorized), true);
      const listCalls = guestFake.requests.filter((request) => request.path === '/api/fs/list');
      check('only the guest ever got to list anything', listCalls.every((request) => !request.authorized), true);
    } finally {
      await app.close();
    }

    // The other way round: the token can see the notes and the guest cannot.
    // Then the blog genuinely cannot read them, and the error has to say why.
    const blindGuestFake = await startFakeOpenList({ root: guestRoot, basePath: '/public', guestBasePath: '/private' });
    const blindApp = await buildApp(blindGuestFake);
    try {
      const panel = await blindApp.getJson('/api/notes');
      check('the panel reads the notes with its token', [panel.status, (panel.payload.notes ?? []).map((note) => note.path)], [200, ['/访客可见.md']]);
      const blog = await blindApp.getJson('/api/blog');
      check('while the blog reports that the guest cannot see them', [blog.status, blog.payload.error?.code], [403, 'openlist_forbidden']);
      check('with a message about the guest account', /访客/.test(blog.payload.error?.message ?? ''), true);
    } finally {
      await blindApp.close();
      await blindGuestFake.close();
    }

    // Guests switched off on the OpenList side: the blog has to say so, and the
    // panel (which has a token) keeps working.
    const disabledFake = await startFakeOpenList({ root: guestRoot, basePath: '/', guestBasePath: '/public', guestDisabled: true });
    const disabledApp = await buildApp(disabledFake);
    try {
      const blocked = await disabledApp.getJson('/api/blog');
      check('a guest-disabled OpenList is reported on the blog, not hidden', [blocked.status, blocked.payload.error?.code], [403, 'openlist_guest_disabled']);
      const message = blocked.payload.error?.message ?? '';
      check('with a message that points at the OpenList setting', [/访客/.test(message), /Guest user is disabled/.test(message)], [true, true]);
      const panelStill = await disabledApp.getJson('/api/notes');
      check('while the panel, which has a token, still works', panelStill.status, 200);
    } finally {
      await disabledApp.close();
      await disabledFake.close();
    }
  } finally {
    if (guestServer) {
      const closed = new Promise((resolve) => guestServer.close(resolve));
      guestServer.closeAllConnections?.();
      await closed;
    }
    await guestFake.close();
    fs.rmSync(guestRoot, { recursive: true, force: true });
  }

  /* ---- a root that cannot be read is not an empty library --------------- */
  // The reader used to get a silent empty blog here: the folder simply did not
  // answer, and "no answer" was turned into "no notes".
  fs.rmSync(fakePath('/notes'), { recursive: true, force: true });
  notes.clearCaches();
  const brokenBlog = await blogCall('GET', '');
  check('a root that cannot be read is an error, not an empty blog', [brokenBlog.status, brokenBlog.payload.error.code], [404, 'openlist_root_missing']);
  check('and the message names the root it could not read', brokenBlog.payload.error.message.includes('/notes'), true);
  const brokenPanel = await call('GET', '');
  check('the panel says the same thing instead of looking empty', [brokenPanel.status, brokenPanel.payload.error.code], [404, 'openlist_root_missing']);
  const missingSub = await driver.list('/没有这个子目录').then((entries) => entries, (err) => err.code);
  check('a folder that is missing is still just empty', missingSub, []);
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
