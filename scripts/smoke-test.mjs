#!/usr/bin/env node
/**
 * End-to-end smoke test for the notes-manager-web HTTP API.
 *
 * Usage:
 *   node scripts/smoke-test.mjs [baseUrl] [username] [password]
 *
 * It signs in, then exercises the full note lifecycle (create / read / list /
 * update / tag / pin / trash / restore / delete) and prints a summary.
 */
const baseUrl = (process.argv[2] ?? process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '');
const username = process.argv[3] ?? process.env.SMOKE_USERNAME ?? 'admin';
const password = process.argv[4] ?? process.env.SMOKE_PASSWORD ?? 'test-admin-pass';
/** `local` (default) or `openlist` - which sign-in endpoint to exercise. */
const provider = process.env.SMOKE_PROVIDER ?? 'local';

let cookie = '';
let passed = 0;
let failed = 0;

function ok(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  \u2713 ${name}`);
  } else {
    failed += 1;
    console.error(`  \u2717 ${name} ${detail}`);
  }
}

async function call(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  for (const entry of setCookie) {
    cookie = entry.split(';')[0];
  }
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text.slice(0, 300) };
  }
  return { status: response.status, payload };
}

async function main() {
  console.log(`\nnotes-manager-web smoke test -> ${baseUrl} (provider: ${provider})\n`);

  const health = await call('GET', '/api/system/health');
  ok('GET /api/system/health', health.status === 200 && health.payload?.ok === true, JSON.stringify(health.payload));
  const driver = health.payload?.storage?.driver;
  console.log(`  storage driver: ${driver} (${health.payload?.storage?.mode}) - ${health.payload?.storage?.detail}`);

  const providers = await call('GET', '/api/auth/providers');
  ok('GET /api/auth/providers', providers.status === 200 && typeof providers.payload?.local === 'boolean');

  const login = await call('POST', '/api/auth/login', { username, password, provider });
  ok(`POST /api/auth/login (provider=${provider})`, login.status === 200 && Boolean(login.payload?.user), JSON.stringify(login.payload));
  if (login.status === 200) {
    console.log(`  signed in as ${login.payload.user.username} via ${login.payload.provider} (${login.payload.user.role})`);
  }
  if (login.status !== 200) {
    console.error('\nCannot continue without a session. Check SMOKE_USERNAME / SMOKE_PASSWORD / SMOKE_PROVIDER.');
    process.exit(1);
  }

  const me = await call('GET', '/api/auth/me');
  ok('GET /api/auth/me', me.payload?.user?.username === username);

  const created = await call('POST', '/api/notes', {
    title: `Smoke test ${new Date().toISOString().slice(11, 19)}`,
    content: '# Hello\n\nThis note was created by the smoke test.\n\n- alpha\n- beta\n',
    tags: ['smoke', 'ci'],
  });
  ok('POST /api/notes', created.status === 201 && Boolean(created.payload?.note?.id), JSON.stringify(created.payload));
  const id = created.payload?.note?.id;
  const path = created.payload?.note?.path;
  console.log(`  created note: ${path}`);

  const listed = await call('GET', '/api/notes');
  ok('GET /api/notes', listed.status === 200 && listed.payload.notes.some((n) => n.id === id));
  ok('  list payload has tags/folders/stats', Array.isArray(listed.payload.tags) && Array.isArray(listed.payload.folders) && Boolean(listed.payload.stats));

  const fetched = await call('GET', `/api/notes/${id}`);
  ok('GET /api/notes/:id returns markdown body', fetched.payload?.note?.content?.includes('alpha'));

  const updated = await call('PUT', `/api/notes/${id}`, {
    content: '# Hello\n\nUpdated body with more words here.\n',
    tags: ['smoke', 'updated'],
    pinned: true,
  });
  ok('PUT /api/notes/:id', updated.status === 200 && updated.payload?.note?.tags?.includes('updated'));
  ok('  pinned flag persisted', updated.payload?.note?.pinned === true);

  const search = await call('GET', '/api/notes?q=Updated');
  ok('GET /api/notes?q=… (full text search)', search.payload?.notes?.some((n) => n.id === id));

  const tagList = await call('GET', '/api/notes/tags');
  ok('GET /api/notes/tags', tagList.payload?.tags?.some((t) => t.tag === 'smoke'));

  const removed = await call('DELETE', `/api/notes/${id}`);
  ok('DELETE /api/notes/:id (to trash)', removed.status === 200 && removed.payload?.trashed === true);

  const trash = await call('GET', '/api/notes/trash');
  ok('GET /api/notes/trash', trash.payload?.notes?.some((n) => n.id === id));

  const restored = await call('POST', `/api/notes/${id}/restore`);
  ok('POST /api/notes/:id/restore', restored.status === 200 && restored.payload?.note?.id === id);

  const folder = await call('POST', '/api/notes/folders', { path: 'smoke-folder' });
  ok('POST /api/notes/folders', folder.status === 201 && folder.payload?.folder === 'smoke-folder');

  const inFolder = await call('POST', '/api/notes', { title: 'Folder note', folder: 'smoke-folder' });
  ok('POST /api/notes (into folder)', inFolder.payload?.note?.folder === 'smoke-folder');

  const purge = await call('DELETE', `/api/notes/${id}?permanent=true`);
  ok('DELETE /api/notes/:id?permanent=true', purge.status === 200);

  await call('DELETE', `/api/notes/${inFolder.payload?.note?.id}?permanent=true`);
  const folderGone = await call('DELETE', '/api/notes/folders?path=smoke-folder');
  ok('DELETE /api/notes/folders', folderGone.status === 200);

  const settings = await call('GET', '/api/system/settings');
  ok('GET /api/system/settings', settings.status === 200 && Boolean(settings.payload?.effective?.storage));

  const logout = await call('POST', '/api/auth/logout');
  ok('POST /api/auth/logout', logout.status === 200);

  const after = await call('GET', '/api/notes');
  ok('session invalidated after logout', after.status === 401);

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('smoke test crashed:', err);
  process.exit(1);
});
