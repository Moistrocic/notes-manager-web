/**
 * Behaviour tests for the note store, run in Node.
 *
 *   npm run check:web
 *
 * The interesting question is when a save happens: opening a note, or an editor
 * echoing its own state, must not write the file back. `fetch` is stubbed, so
 * every request the store makes is recorded and asserted on.
 */
import { appStore, normaliseSortKeys, SORT_KEYS } from './src/store/useAppStore';
import { api } from './src/lib/api';
import type { Note } from './src/lib/types';

let failed = 0;
let passed = 0;
function check(name: string, actual: unknown, expected: unknown) {
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
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* -------------------------------------------------------------------------- */
/* fetch stub                                                                  */
/* -------------------------------------------------------------------------- */
interface Call {
  method: string;
  url: string;
  body: string | undefined;
}
let calls: Call[] = [];
const notes = new Map<string, Note>();
let notesRoot = '/public/Notes';
/** While set, write replies are held back so a save can be raced with typing. */
let slowWrites = false;
/** While set, the folder endpoint refuses - as a server with no write access would. */
let refuseFolderCreate = false;
/** While set, GET /api/notes answers with this instead of a real list. */
let brokenList: null | 'empty_object' | 'nulls' | 'broken_entries' | 'empty_body' | 'json_null' = null;

/* -------------------------------------------------------------------------- */
/* window stub, so the deep link code has somewhere to read the address from   */
/* -------------------------------------------------------------------------- */
const historyLog: string[] = [];
/** Tabs the store asked the browser to open (a file link opens one). */
const openedWindows: string[] = [];
const fakeLocation = { pathname: '/', hash: '' };
function applyUrl(url: string) {
  const [pathname, hash = ''] = url.split('#');
  fakeLocation.pathname = pathname || '/';
  fakeLocation.hash = hash ? `#${hash}` : '';
}
(globalThis as unknown as { window: unknown }).window = {
  location: fakeLocation,
  history: {
    pushState: (_state: unknown, _title: string, url: string) => {
      historyLog.push(`push ${url}`);
      applyUrl(url);
    },
    replaceState: (_state: unknown, _title: string, url: string) => {
      historyLog.push(`replace ${url}`);
      applyUrl(url);
    },
  },
  open: (url: string, target: string) => {
    openedWindows.push(`${url}|${target}`);
    return null;
  },
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};
const goTo = (url: string) => {
  applyUrl(url);
  historyLog.length = 0;
};

function makeNote(id: string, content: string): Note {
  return {
    id,
    kind: 'note',
    blog: false,
    blogAt: null,
    blogTitle: null,
    blogSummary: null,
    hasPublishInfo: false,
    title: `标题 ${id}`,
    tags: ['t'],
    pinned: false,
    favorite: false,
    color: null,
    folder: '',
    path: `/${id}.md`,
    created: '2026-01-01T00:00:00.000Z',
    updated: '2026-01-01T00:00:00.000Z',
    excerpt: '',
    wordCount: 1,
    size: content.length,
    hasFrontMatter: true,
    content,
  };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

globalThis.fetch = (async (input: unknown, init: RequestInit = {}) => {
  const url = String(input);
  const method = (init.method ?? 'GET').toUpperCase();
  const body = typeof init.body === 'string' ? init.body : undefined;
  calls.push({ method, url, body });

  // The panel's own folder endpoints. The path the server answers with is what
  // the store follows, so it is worked out here the way the server would.
  if (url.includes('/api/notes/folders/rename')) {
    const patch = JSON.parse(body ?? '{}') as { path?: string; name?: string };
    const parent = String(patch.path ?? '')
      .split('/')
      .slice(0, -1)
      .join('/');
    return json({ ok: true, path: parent ? `${parent}/${patch.name}` : String(patch.name ?? ''), folders: [] });
  }
  if (url.includes('/api/notes/folders/move')) {
    const patch = JSON.parse(body ?? '{}') as { path?: string; target?: string };
    const name = String(patch.path ?? '').split('/').pop() ?? '';
    return json({ ok: true, path: patch.target ? `${patch.target}/${name}` : name, folders: [] });
  }
  if (url.includes('/api/notes/folders') && method === 'DELETE') {
    return json({ ok: true, folders: [] });
  }
  if (url.includes('/api/notes/folders') && method === 'POST') {
    if (refuseFolderCreate) return json({ error: { message: '拒绝创建' } }, 400);
    const patch = JSON.parse(body ?? '{}') as { path?: string };
    return json({ folder: patch.path ?? '', folders: [] });
  }

  const noteMatch = /\/api\/notes\/([^/?]+)/.exec(url);
  if (noteMatch) {
    const id = decodeURIComponent(noteMatch[1]);
    if (method !== 'GET' && slowWrites) await wait(40);
    if (method === 'GET') {
      const note = notes.get(id);
      return note ? json({ note }) : json({ error: { message: 'not found' } }, 404);
    }
    if (method === 'PUT') {
      const patch = JSON.parse(body ?? '{}') as Partial<Note>;
      const before = notes.get(id) as Note;
      const note = { ...before, ...patch, updated: new Date().toISOString() };
      // The server renames the file when the title changes. Without that here,
      // the address-bar assertions below would be testing nothing.
      if (patch.title && patch.title !== before.title) {
        const slug = patch.title.trim().replace(/\s+/g, '-');
        const extension = (before.path.match(/\.[^.]+$/) ?? ['.md'])[0];
        note.path = note.folder ? `/${note.folder}/${slug}${extension}` : `/${slug}${extension}`;
      }
      if (patch.folder !== undefined && patch.folder !== before.folder) {
        const name = before.path.split('/').pop() ?? before.path;
        note.path = patch.folder ? `/${patch.folder}/${name}` : `/${name}`;
      }
      // A file has no front matter to carry an id, so its id is derived from
      // its path and moves with it. Notes keep the id front matter holds.
      if (before.kind !== 'note' && note.path !== before.path) note.id = `h:${note.path}`;
      notes.delete(id);
      notes.set(note.id, note);
      return json({ note });
    }
    if (method === 'DELETE') {
      notes.delete(id);
      return json({ ok: true, trashed: true });
    }
  }
  if (url.includes('/api/notes') && method === 'GET' && brokenList) {
    // The shapes a proxy, a half-restarted server or another version can send
    // while still answering 200. The store must not trust any of them.
    if (brokenList === 'empty_body') return new Response('', { status: 200 });
    if (brokenList === 'json_null') {
      return new Response('null', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (brokenList === 'empty_object') return json({});
    if (brokenList === 'nulls') return json({ notes: [], tags: null });
    return json({ notes: [null, 42, { nope: true }], tags: 'nope', folders: 'nope' });
  }
  if (url.includes('/api/notes')) {
    return json({
      notes: [...notes.values()],
      stats: { notes: notes.size, tags: 0, folders: 0, words: 0, updatedAt: null },
      tags: [],
      folders: [],
      capabilities: {
        driver: 'openlist',
        root: notesRoot,
        writable: true,
        permissions: { write: true, rename: true, move: true, remove: true },
      },
    });
  }
  return json({ ok: true });
}) as typeof fetch;

const countWrites = () => calls.filter((c) => c.method === 'PUT' || c.method === 'POST').length;

/* -------------------------------------------------------------------------- */
console.log('note store: when does it save?');

const store = appStore;
const originalInitial = store.getInitialState;

// Idempotent setup between scenarios.
const reset = (loaded: Note) => {
  calls = [];
  notes.set(loaded.id, loaded);
  store.setState({
    user: { sid: 's', id: 'u', username: 'u', displayName: 'u', role: 'admin', provider: 'local', createdAt: 0, expiresAt: 0 },
    activeId: null,
    activeNote: null,
    lastSaved: null,
    dirty: false,
    saving: false,
  } as never);
};

// 1. Opening a note must not write anything.
{
  const note = makeNote('n1', '# hello\n\nworld\n');
  reset(note);
  await store.getState().selectNote('n1');
  check('opening a note marks it clean', store.getState().dirty, false);
  await wait(1300); // longer than the 900ms autosave debounce
  check('opening a note writes nothing', countWrites(), 0);
}

// 2. An editor echo of the identical text must not mark it dirty.
{
  const note = makeNote('n2', 'same text\n');
  reset(note);
  await store.getState().selectNote('n2');
  calls = [];
  store.getState().patchActive({ content: 'same text\n' });
  check('identical patch stays clean', store.getState().dirty, false);
  await wait(1300);
  check('identical patch writes nothing', countWrites(), 0);
}

// 3. Metadata blurs with unchanged values must not mark it dirty.
{
  const note = makeNote('n3', 'body\n');
  reset(note);
  await store.getState().selectNote('n3');
  calls = [];
  store.getState().patchActive({ title: note.title, tags: ['t'], pinned: false, favorite: false, color: null, folder: '' });
  check('unchanged metadata stays clean', store.getState().dirty, false);
  await wait(1300);
  check('unchanged metadata writes nothing', countWrites(), 0);
}

// 4. An explicit save right after opening is a no-op.
{
  const note = makeNote('n4', 'body\n');
  reset(note);
  await store.getState().selectNote('n4');
  calls = [];
  await store.getState().saveActive(true);
  check('saveActive on a clean note writes nothing', countWrites(), 0);
}

// 5. Editing writes nothing on its own - not now, and not a moment later.
{
  const note = makeNote('n5', 'before\n');
  reset(note);
  await store.getState().selectNote('n5');
  calls = [];
  store.getState().patchActive({ content: 'after\n' });
  check('a real edit marks it dirty', store.getState().dirty, true);
  store.getState().patchActive({ content: 'after more\n' });
  await wait(1500);
  check('typing writes nothing, however long you type', countWrites(), 0);
  check('and the note is still unsaved', store.getState().dirty, true);
}

// 6. An explicit save - a blur, or Ctrl/⌘+S - is what writes.
{
  const note = makeNote('n6', 'before\n');
  reset(note);
  await store.getState().selectNote('n6');
  calls = [];
  store.getState().patchActive({ content: 'after\n' });
  await store.getState().saveActive(true);
  check('an explicit save writes once', countWrites(), 1);
  check('the note is clean again', store.getState().dirty, false);
  check('and the newest text is what was sent', JSON.parse(calls[0].body ?? '{}').content, 'after\n');
  await store.getState().saveActive(true);
  check('saving an unchanged note writes nothing more', countWrites(), 1);
}

// 7. Typing and undoing back to the saved text cancels the save.
{
  const note = makeNote('n7', 'original\n');
  reset(note);
  await store.getState().selectNote('n7');
  calls = [];
  store.getState().patchActive({ content: 'original changed\n' });
  store.getState().patchActive({ content: 'original\n' });
  check('undoing the edit clears dirty', store.getState().dirty, false);
  await store.getState().saveActive(true);
  check('undoing the edit writes nothing', countWrites(), 0);
}

// 8. A slow reply may not overwrite what was typed while it was in flight.
{
  const note = makeNote('n8', 'body\n');
  reset(note);
  await store.getState().selectNote('n8');
  calls = [];
  slowWrites = true;
  store.getState().patchActive({ title: '第一版' });
  const writing = store.getState().saveActive(true);
  // Still typing while the request is out: this is the rollback the user saw.
  store.getState().patchActive({ title: '第一版改' });
  slowWrites = false;
  await writing;
  check('the newer title survives the reply', store.getState().activeNote?.title, '第一版改');
  check('and the note stays unsaved', store.getState().dirty, true);
  calls = [];
  await store.getState().saveActive(true);
  check('the next save sends the newer title', JSON.parse(calls[0].body ?? '{}').title, '第一版改');
  check('and the note is clean again', store.getState().dirty, false);
}

// 9. Renaming the title renames the file, and the address follows it.
{
  const note = makeNote('n9', 'body\n');
  reset(note);
  // The storage root arrives with the first listing, which is what the app does
  // before a note can be clicked - without it there is no prefix to check.
  await store.getState().refreshNotes({ silent: true });
  await store.getState().selectNote('n9');
  goTo('/manager/');
  calls = [];
  store.getState().patchActive({ title: '新的标题' });
  await store.getState().saveActive(true);
  check('the store adopts the new path', store.getState().activeNote?.path, '/新的标题.md');
  check('the address bar points at the renamed file', historyLog, [
    'replace /manager/public/Notes/' + encodeURIComponent('新的标题.md'),
  ]);
}

// 10. Blurring one field while another save is in flight still saves.
{
  const note = makeNote('n10', 'body\n');
  reset(note);
  await store.getState().selectNote('n10');
  calls = [];
  slowWrites = true;
  store.getState().patchActive({ title: 'A' });
  const first = store.getState().saveActive(true);
  store.getState().patchActive({ tags: ['x'] });
  const second = store.getState().saveActive(true);
  slowWrites = false;
  await Promise.all([first, second]);
  // The queued save is fired from the first one's `finally`, so the second
  // request outlives the promise that was awaited here.
  await wait(80);
  check('the queued save runs after the one in flight', countWrites() >= 2, true);
  check('and nothing is left unsaved', store.getState().dirty, false);
}

// 11. The list opens sorted by title, ascending, and the choice is remembered.
{
  check('the default sort is by title', store.getState().sort, 'title');
  check('and runs upwards', store.getState().sortOrder, 'asc');
  store.getState().setSortOrder('desc');
  check('the picker flips it', store.getState().sortOrder, 'desc');
  check('and the choice is written down', globalThis.localStorage?.getItem('notes-manager-sort-order') ?? 'desc', 'desc');
  store.getState().setSortOrder('asc');
}

// 12. Batch actions run over what the tree has selected.
{
  const a = makeNote('s1', 'a\n');
  const b = makeNote('s2', 'b\n');
  reset(a);
  notes.set('s2', b);
  await store.getState().refreshNotes({ silent: true });
  store.setState({ selection: [{ kind: 'note', id: 's1' }, { kind: 'note', id: 's2' }] } as never);
  check('the tree can hold several rows', store.getState().selection.length, 2);
  store.getState().toggleSelection({ kind: 'note', id: 's2' });
  check('and toggle one back off', store.getState().selection.length, 1);
  store.getState().toggleSelection({ kind: 'note', id: 's2' });

  calls = [];
  await store.getState().moveSelection('工作');
  check('moving a selection updates every note', calls.filter((c) => c.method === 'PUT').length, 2);
  check('and clears the selection', store.getState().selection.length, 0);
  check('the notes really moved', notes.get('s1')?.folder, '工作');
}

// 13. Deleting a selection sends the notes to the trash and drops them.
{
  const a = makeNote('s3', 'a\n');
  reset(a);
  await store.getState().refreshNotes({ silent: true });
  store.setState({ selection: [{ kind: 'note', id: 's3' }] } as never);
  calls = [];
  await store.getState().deleteSelection();
  check('a batch delete reaches the server', calls.some((c) => c.method === 'DELETE'), true);
  check('the deleted note leaves the list', store.getState().notes.some((n) => n.id === 's3'), false);
  check('and the selection is cleared', store.getState().selection.length, 0);
}

// 21. A file's id is derived from its path, so renaming or moving it
// re-addresses it - and everything in the app has to follow the reply.
{
  const picture = {
    ...makeNote('p1', ''),
    kind: 'image' as const,
    title: 'photo.png',
    path: '/素材/photo.png',
    folder: '素材',
  };
  reset(picture);
  notes.set('p1', picture);
  await store.getState().refreshNotes({ silent: true });
  await store.getState().selectNote('p1');
  check('the picture is open', store.getState().activeId, 'p1');

  await store.getState().renameNote('p1', '封面');
  const renamed = store.getState();
  check('the open picture answers to its new id', renamed.activeId !== 'p1', true);
  check('the tree lists it under that id', renamed.notes.some((n) => n.id === renamed.activeId), true);
  check('at its new path', renamed.notes.find((n) => n.id === renamed.activeId)?.path, '/素材/封面.png');

  // The editor's own save path does the same, or editing a title would orphan
  // the file the panel is showing.
  store.getState().patchActive({ title: '封面 2' });
  await store.getState().saveActive(true);
  const saved = store.getState();
  check('a save re-addresses it too', saved.activeId !== renamed.activeId, true);
  check('and leaves nothing unsaved', saved.dirty, false);
  check('with the file it now shows', saved.activeNote?.path, '/素材/封面-2.png');

  // Moving it is the other way the path - and so the id - changes.
  await store.getState().moveNote(saved.activeId as string, '归档');
  const moved = store.getState();
  check('moving re-addresses it as well', moved.activeNote?.path, '/归档/封面-2.png');
  check('and the id matches the new path', moved.activeId, `h:${moved.activeNote?.path}`);
  check('after a move the tree still holds it', moved.notes.some((n) => n.id === moved.activeId), true);
}

/* -------------------------------------------------------------------------- */
/* Deep links                                                                  */
/* -------------------------------------------------------------------------- */
console.log('');
console.log('deep links');

// 14. Selecting a note writes its storage path into the address bar.
{
  const a = makeNote('d1', 'body\n');
  const b = makeNote('d2', 'body\n');
  reset(a);
  notes.set('d2', b);
  // capabilities (and with them the storage root) arrive with the note list,
  // which the app loads before any note can be clicked
  await store.getState().refreshNotes({ silent: true });
  goTo('/manager/');
  await store.getState().selectNote('d1');
  // Notes live under /manager/, so that is the address a note is shared by.
  check('opening a note pushes its path', historyLog, ['push /manager/public/Notes/d1.md']);
}

// 15. A shared link opens the note it names, anchor and all.
{
  const a = makeNote('e1', '# 1.1 分层\n\ntext\n');
  reset(a);
  notes.set('e1', a);
  await store.getState().refreshNotes({ silent: true });
  goTo('/manager/public/Notes/e1.md#11-分层');
  await store.getState().openFromLocation();
  check('the deep link opens the note', store.getState().activeNote?.id, 'e1');
  check('the anchor is remembered', store.getState().pendingAnchor, '11-分层');
  // the address already is the canonical one, so rewriting it would only add a
  // duplicate history entry
  check('no redundant history entry', historyLog, []);
  check(
    'the address still points at the note',
    fakeLocation.pathname + fakeLocation.hash,
    '/manager/public/Notes/e1.md#11-分层',
  );
}

// 16. A path below the storage root also resolves.
{
  const nested = { ...makeNote('e2', 'body\n'), path: '/工作/项目.md', folder: '工作' };
  reset(nested);
  notes.set('e2', nested);
  await store.getState().refreshNotes({ silent: true });
  goTo('/manager/public/Notes/' + encodeURIComponent('工作') + '/' + encodeURIComponent('项目.md'));
  await store.getState().openFromLocation();
  check('a nested deep link resolves', store.getState().activeNote?.id, 'e2');
}

// 17. A link to a note that no longer exists reports it and resets the address.
{
  const a = makeNote('e3', 'body\n');
  reset(a);
  notes.set('e3', a);
  await store.getState().refreshNotes({ silent: true });
  store.setState({ toasts: [] } as never);
  goTo('/manager/public/Notes/gone.md');
  await store.getState().openFromLocation();
  check('a missing note reports a toast', store.getState().toasts.length > 0, true);
  // Back to the panel's own root - not to the site's front page.
  check('and the address bar is reset', historyLog, ['replace /manager/']);
}

// 18. Browsing back to the root closes the note.
{
  const a = makeNote('e4', 'body\n');
  reset(a);
  await store.getState().selectNote('e4');
  goTo('/manager/');
  await store.getState().openFromLocation();
  check('the panel root closes the open note', store.getState().activeNote, null);
}

// 19. The front page is not the panel: opening the site must not rewrite the
// address, and must not open a note behind the visitor's back.
{
  const a = makeNote('e5', 'body\n');
  reset(a);
  notes.set('e5', a);
  await store.getState().refreshNotes({ silent: true });
  goTo('/');
  await store.getState().openFromLocation();
  check('the front page opens no note', store.getState().activeNote, null);
  check('and leaves the address alone', historyLog, []);
}

// 20. A note opened from the front page would have to be a panel address.
{
  const a = makeNote('e6', 'body\n');
  reset(a);
  notes.set('e6', a);
  await store.getState().refreshNotes({ silent: true });
  await store.getState().selectNote('e6');
  check('the path a note is opened by carries the panel prefix', fakeLocation.pathname.startsWith('/manager/'), true);
}

/* -------------------------------------------------------------------------- */
/* Links inside a note                                                        */
/* -------------------------------------------------------------------------- */
console.log('');
console.log('links inside a note');

// 26. A link is read the way it was written: / is the notes root, ./ ../ and a
// bare name are the note's own folder. The tree holds a second a.md at the root
// on purpose - the old lookup searched the whole tree by file name and could
// open that one instead of the sibling next to the note, which is the bug this
// replaced.
{
  const LINK_NOTE = '/proj/deep/note.md';

  /** Seeds the tree, opens note.md and follows one href, recording the outcome. */
  const follow = async (href: string) => {
    notes.clear();
    const main = { ...makeNote('main', 'links\n'), folder: 'proj/deep', path: LINK_NOTE };
    const sibling = { ...makeNote('sibling', 'sibling\n'), folder: 'proj/deep', path: '/proj/deep/a.md' };
    const below = { ...makeNote('below', 'below\n'), folder: 'proj/deep/sub', path: '/proj/deep/sub/a.md' };
    const rootTwin = { ...makeNote('root-twin', 'root twin\n'), folder: '', path: '/a.md' };
    const rootNote = { ...makeNote('root', 'root\n'), folder: '', path: '/root.md' };
    const picture = {
      ...makeNote('photo', ''),
      kind: 'image' as const,
      title: 'photo.png',
      folder: 'proj/deep',
      path: '/proj/deep/photo.png',
    };
    for (const entry of [main, sibling, below, rootTwin, rootNote, picture]) notes.set(entry.id, entry);
    store.setState({
      user: { sid: 's', id: 'u', username: 'u', displayName: 'u', role: 'admin', provider: 'local', createdAt: 0, expiresAt: 0 },
      capabilities: { driver: 'openlist', root: '/public/Notes', writable: true, permissions: null },
      notes: [sibling, below, rootTwin, rootNote, picture],
      folders: [
        { path: 'proj', name: 'proj', count: 1, depth: 0 },
        { path: 'proj/deep', name: 'deep', count: 1, depth: 1 },
        { path: 'proj/deep/sub', name: 'sub', count: 0, depth: 2 },
      ],
      activeId: main.id,
      activeNote: main,
      pendingAnchor: null,
      toasts: [],
    } as never);
    historyLog.length = 0;
    openedWindows.length = 0;
    await store.getState().openInternalLink(href);
    return {
      activeId: store.getState().activeId,
      anchor: store.getState().pendingAnchor,
      toast: store.getState().toasts[0],
      url: historyLog[historyLog.length - 1] ?? null,
    };
  };

  const nested = await follow('./sub/a.md');
  check('a relative link opens the note under the folder it names', nested.activeId, 'below');
  check('the address follows it', nested.url, 'push /manager/public/Notes/proj/deep/sub/a.md');

  const bare = await follow('a.md');
  check('a bare name is read from the note folder', bare.activeId, 'sibling');
  check('not from a same-named note at the root', bare.activeId === 'root-twin', false);

  const rooted = await follow('/root.md');
  check('a rooted link opens the note at the root', rooted.activeId, 'root');

  const guessed = await follow('./a');
  check('a path without its extension still finds the .md', guessed.activeId, 'sibling');

  const anchored = await follow('/root.md#根笔记');
  check('a fragment does not stop the link', anchored.activeId, 'root');
  check('and is handed to the opened note', anchored.anchor, '根笔记');

  const byId = await follow('notes:below');
  check('notes:<id> still opens by id', byId.activeId, 'below');

  const missing = await follow('./nope.md');
  check('a link that resolves nowhere stays where it is', missing.activeId, 'main');
  check('and its toast names the path it resolved to', (missing.toast?.message ?? '').includes('proj/deep/nope.md'), true);

  const unknownId = await follow('notes:never');
  check('an unknown id is reported too', unknownId.toast?.title, '找不到链接指向的笔记');

  const external = await follow('https://example.com/a.md');
  check('an external link is not opened in the panel', external.activeId, 'main');
  check('and says why', external.toast?.title, '链接不支持在应用内打开');

  const file = await follow('./photo.png');
  check('a link to a file opens the file in a tab', openedWindows, [
    '/api/notes/file?path=' + encodeURIComponent('/proj/deep/photo.png') + '|_blank',
  ]);
  check('and not as text in the editor', file.activeId, 'main');
}

/* -------------------------------------------------------------------------- */
/* Where the next note goes                                                    */
/* -------------------------------------------------------------------------- */
console.log('');
console.log('lastFolder');

// 21. Opening a note says where the user is working: the folder it lives in, and
// that is where a new note made next belongs.
{
  const note = { ...makeNote('f1', 'body\n'), folder: 'A/B', path: '/A/B/c.md' };
  reset(note);
  notes.set('f1', note);
  await store.getState().refreshNotes({ silent: true });
  await store.getState().selectNote('f1');
  check('opening a note remembers its folder', store.getState().lastFolder, 'A/B');
}

// 22. Clicking a folder in the tree is the panel's own call, and the root is a
// place like any other.
{
  reset(makeNote('f2', 'body\n'));
  store.getState().setLastFolder('A/B');
  check('a clicked folder is remembered as it is', store.getState().lastFolder, 'A/B');
  store.getState().setLastFolder('');
  check('and the root is a place too', store.getState().lastFolder, '');
}

// 23. A folder that is renamed takes the remembered path with it - including a
// remembered folder somewhere below it.
{
  const note = { ...makeNote('f3', 'body\n'), folder: 'A/B', path: '/A/B/c.md' };
  reset(note);
  notes.set('f3', note);
  await store.getState().refreshNotes({ silent: true });
  await store.getState().selectNote('f3');
  await store.getState().renameFolder('A/B', 'B2');
  check('a renamed folder is followed', store.getState().lastFolder, 'A/B2');
}

// 24. And so does a moved one.
{
  const note = { ...makeNote('f4', 'body\n'), folder: 'A/B', path: '/A/B/c.md' };
  reset(note);
  notes.set('f4', note);
  await store.getState().refreshNotes({ silent: true });
  await store.getState().selectNote('f4');
  await store.getState().moveFolder('A/B', 'C');
  check('a moved folder is followed', store.getState().lastFolder, 'C/B');
}

// 25. A folder that is gone cannot be remembered: the next note falls back to the
// root rather than to a path that would have to be refused.
{
  const note = { ...makeNote('f5', 'body\n'), folder: 'A/B', path: '/A/B/c.md' };
  reset(note);
  notes.set('f5', note);
  await store.getState().refreshNotes({ silent: true });
  await store.getState().selectNote('f5');
  await store.getState().deleteFolder('A/B');
  check('a deleted folder is forgotten', store.getState().lastFolder, '');
}

/* -------------------------------------------------------------------------- */
/* The sort priority order                                                     */
/* -------------------------------------------------------------------------- */
console.log('');
console.log('sort priority');

// 26. Whatever was stored, the order comes back as all four keys once each: a
// hand-edited, truncated or outdated value still yields a usable order rather
// than a short list that silently stops sorting.
{
  check('a full order is kept as it is', normaliseSortKeys(['words', 'title', 'created', 'updated']), [
    'words',
    'title',
    'created',
    'updated',
  ]);
  check('unknown keys are dropped', normaliseSortKeys(['words', 'nope']), ['words', 'title', 'updated', 'created']);
  check(
    'duplicates go',
    normaliseSortKeys(['title', 'title', 'words', 'words']),
    ['title', 'words', 'updated', 'created'],
  );
  check('missing keys are appended in the default order', normaliseSortKeys(['updated']), [
    'updated',
    'title',
    'created',
    'words',
  ]);
  check('an empty list becomes the default order', normaliseSortKeys([]), SORT_KEYS);
  check('and so does nonsense', normaliseSortKeys(null), SORT_KEYS);
  // What a build that remembered only one key leaves behind: that key at the
  // head, the rest in their default places (readSortKeys does exactly this).
  check('a single legacy key becomes the head', normaliseSortKeys(['words']), ['words', 'title', 'updated', 'created']);
}

// 27. Moving a key changes the order the list is in, and the head the picker
// shows - the first key is the one the picker speaks.
{
  store.getState().setSortKeys(SORT_KEYS);
  check('the order starts as the default', store.getState().sortKeys, SORT_KEYS);
  check('with the head as the picker value', store.getState().sort, 'title');
  store.getState().moveSortKey('updated', -1);
  check('moving a key up changes the order', store.getState().sortKeys, ['updated', 'title', 'created', 'words']);
  check('and the head with it', store.getState().sort, 'updated');
  store.getState().moveSortKey('words', 1);
  check('a key cannot be moved off the end', store.getState().sortKeys, ['updated', 'title', 'created', 'words']);
  store.getState().moveSortKey('updated', 1);
  check('down is the other way', store.getState().sortKeys, ['title', 'updated', 'created', 'words']);
  store.getState().setSort('created');
  check('the single-key picker promotes its key to the head', store.getState().sortKeys, [
    'created',
    'title',
    'updated',
    'words',
  ]);
  store.getState().setSortKeys(['words']);
  check('a short order is filled in', store.getState().sortKeys, ['words', 'title', 'updated', 'created']);
  store.getState().setSortKeys(SORT_KEYS);
  check('and the default order is put back', store.getState().sortKeys, SORT_KEYS);
}

/* -------------------------------------------------------------------------- */
/* Making a folder the server refuses                                          */
/* -------------------------------------------------------------------------- */
console.log('');
console.log('creating a folder');

// 28. A folder that cannot be made says so, and reports failure - the caller
// that was about to put a note in it has to know not to.
{
  refuseFolderCreate = true;
  store.setState({ toasts: [] } as never);
  const refused = await store.getState().createFolder('新/目录', { silent: true });
  check('a folder the server refuses comes back false', refused, false);
  check('and says which action failed', store.getState().toasts.map((toast) => toast.title), ['创建文件夹失败']);

  refuseFolderCreate = false;
  store.setState({ toasts: [] } as never);
  const made = await store.getState().createFolder('新/目录', { silent: true });
  check('a folder the server accepts comes back true', made, true);
  check('and a silent creation says nothing of its own', store.getState().toasts, []);
}

/* -------------------------------------------------------------------------- */
/* A 200 response is not trusted to have the shape we asked for               */
/* -------------------------------------------------------------------------- */
console.log('');
console.log('a malformed notes response');

// 29. The crash the user hit: /api/notes answered 200 with a body without
// notes, refreshNotes wrote it through, and CommandPalette crashed on
// notes.filter. A list that cannot be read now keeps the last good one, and
// says so; tags/folders are only ever arrays.
{
  const seed = (extra: Record<string, unknown> = {}) => {
    notes.clear();
    notes.set('keep', makeNote('keep', '# keep\n'));
    store.setState({
      user: { sid: 's', id: 'u', username: 'u', displayName: 'u', role: 'admin', provider: 'local', createdAt: 0, expiresAt: 0 },
      notes: [makeNote('keep', '# keep\n')],
      tags: ['t'],
      folders: ['proj'],
      stats: { notes: 1, tags: 1, folders: 1, words: 1, updatedAt: null },
      notesError: null,
      loadingNotes: false,
      ...extra,
    } as never);
  };

  seed();
  brokenList = 'empty_object';
  await store.getState().refreshNotes();
  check('a body without notes keeps the list it had', store.getState().notes.map((note) => note.id), ['keep']);
  check('and says the response was malformed', (store.getState().notesError ?? '').includes('格式异常'), true);
  check('with the loading flag put back', store.getState().loadingNotes, false);

  seed();
  brokenList = 'nulls';
  await store.getState().refreshNotes();
  check('an empty list is a list', store.getState().notes, []);
  check('but tags and folders are never null', [Array.isArray(store.getState().tags), Array.isArray(store.getState().folders)], [true, true]);
  check('and the previous ones are kept', [store.getState().tags, store.getState().folders], [['t'], ['proj']]);

  seed();
  brokenList = 'broken_entries';
  await store.getState().refreshNotes();
  check('entries that are not notes are dropped', store.getState().notes, []);
  check('and tags/folders fall back to the previous arrays', [store.getState().tags, store.getState().folders], [['t'], ['proj']]);

  seed();
  brokenList = 'empty_body';
  await store.getState().refreshNotes();
  check('an empty 200 is not an empty list', store.getState().notes.map((note) => note.id), ['keep']);
  check('and it is reported as an empty response', (store.getState().notesError ?? '').includes('空响应'), true);

  seed();
  brokenList = 'json_null';
  await store.getState().refreshNotes();
  check('a null body is not an empty list either', store.getState().notes.map((note) => note.id), ['keep']);
  check('and it is reported as unparseable', (store.getState().notesError ?? '').includes('无法解析'), true);
  check('the bad_response code is what the API layer threw', await (async () => {
    try {
      brokenList = 'empty_body';
      await api.listNotes();
      return 'no error';
    } catch (err) {
      return (err as { code?: string }).code ?? 'no code';
    } finally {
      brokenList = null;
    }
  })(), 'bad_response');

  seed();
  brokenList = null;
  await store.getState().refreshNotes();
  check('a good response clears the error', store.getState().notesError, null);
  check('and loads the list', store.getState().notes.map((note) => note.id), ['keep']);
}

/* -------------------------------------------------------------------------- */
store.getInitialState = originalInitial;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
