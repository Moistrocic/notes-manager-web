/**
 * Behaviour tests for the note store, run in Node.
 *
 *   npm run check:web
 *
 * The interesting question is when a save happens: opening a note, or an editor
 * echoing its own state, must not write the file back. `fetch` is stubbed, so
 * every request the store makes is recorded and asserted on.
 */
import { appStore } from './src/store/useAppStore';
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

function makeNote(id: string, content: string): Note {
  return {
    id,
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

  const noteMatch = /\/api\/notes\/([^/?]+)/.exec(url);
  if (noteMatch) {
    const id = decodeURIComponent(noteMatch[1]);
    if (method === 'GET') {
      const note = notes.get(id);
      return note ? json({ note }) : json({ error: { message: 'not found' } }, 404);
    }
    if (method === 'PUT') {
      const patch = JSON.parse(body ?? '{}') as Partial<Note>;
      const note = { ...(notes.get(id) as Note), ...patch, updated: new Date().toISOString() };
      notes.set(id, note);
      return json({ note });
    }
  }
  if (url.includes('/api/notes')) {
    return json({ notes: [...notes.values()], stats: { notes: notes.size, tags: 0, folders: 0, words: 0, updatedAt: null }, tags: [], folders: [] });
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

// 5. A real edit is saved exactly once.
{
  const note = makeNote('n5', 'before\n');
  reset(note);
  await store.getState().selectNote('n5');
  calls = [];
  store.getState().patchActive({ content: 'after\n' });
  check('a real edit marks it dirty', store.getState().dirty, true);
  await wait(1300);
  check('a real edit writes once', countWrites(), 1);
  check('the note is clean again', store.getState().dirty, false);
  await wait(1300);
  check('no follow-up write', countWrites(), 1);
}

// 6. Typing and undoing back to the saved text cancels the save.
{
  const note = makeNote('n6', 'original\n');
  reset(note);
  await store.getState().selectNote('n6');
  calls = [];
  store.getState().patchActive({ content: 'original changed\n' });
  store.getState().patchActive({ content: 'original\n' });
  check('undoing the edit clears dirty', store.getState().dirty, false);
  await wait(1300);
  check('undoing the edit writes nothing', countWrites(), 0);
}

// 7. Deleting characters back to the saved text behaves the same way.
{
  const note = makeNote('n7', 'abc\n');
  reset(note);
  await store.getState().selectNote('n7');
  calls = [];
  store.getState().patchActive({ content: 'ab\n' });
  store.getState().patchActive({ content: 'abc\n' });
  await wait(1300);
  check('retype back writes nothing', countWrites(), 0);
}

/* -------------------------------------------------------------------------- */
store.getInitialState = originalInitial;
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
