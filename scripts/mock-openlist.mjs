#!/usr/bin/env node
/**
 * Minimal OpenList-compatible server used for local development and tests.
 *
 * It implements the subset of the OpenList HTTP API that notes-manager-web
 * relies on, so the OpenList integration can be exercised without installing
 * the real (Go) OpenList binary.
 *
 *   node scripts/mock-openlist.mjs [--port 5244] [--root ./tmp/mock-openlist]
 *
 * Log in with:  admin / admin
 *
 * By default it behaves like a released OpenList build (verified against
 * v4.2.6): /api/public/init_status does NOT exist and unknown paths answer with
 * the SPA HTML, exactly like the real NoRoute handler. Pass --with-init-status
 * to emulate newer builds that do expose it - the client must work with both.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const args = process.argv.slice(2);
function arg(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
}

const PORT = Number.parseInt(arg('port', '5244'), 10);
const ROOT = path.resolve(arg('root', './tmp/mock-openlist'));
const USERS = [
  { id: 1, username: 'admin', password: 'admin', role: 2, permission: 0xffff, base_path: '/' },
  // jailed to /public, like a real OpenList account with a base path
  {
    id: 2,
    username: 'writer',
    password: 'writer',
    role: 0,
    permission: (1 << 3) | (1 << 4) | (1 << 6) | (1 << 7),
    base_path: '/public',
  },
  // read-only account used for the permission tests
  { id: 3, username: 'reader', password: 'reader', role: 0, permission: 0, base_path: '/' },
];

/** The anonymous visitor, mirroring OpenList's guest user (role 1). */
const GUEST = { id: 0, username: 'guest', role: 1, permission: 0, base_path: '/' };

/** OpenList permission bit 3 = mkdir/upload (see internal/model/user.go). */
const canWrite = (user) => (user.permission & (1 << 3)) !== 0;
const API_TOKEN = 'mock-api-token';
/** Newer OpenList builds expose /api/public/init_status; v4.2.6 does not. */
const WITH_INIT_STATUS = args.includes('--with-init-status');
/** `--no-guest` makes anonymous requests fail, as an OpenList with guests off. */
const GUEST_ENABLED = !args.includes('--no-guest');

const SPA_PAGE = [
  '<!doctype html>',
  '<html lang="en" translate="no"><head><meta charset="utf-8"><title>OpenList</title></head>',
  '<body><div id="root"></div></body></html>',
].join('\n');

/** Unknown routes fall through to the SPA with HTTP 200, as OpenList does. */
function spa(res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(SPA_PAGE);
}

const tokens = new Map();

const MIME = {
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

function ok(res, data) {
  const body = JSON.stringify({ code: 200, message: 'success', data: data ?? null });
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function fail(res, status, message) {
  const body = JSON.stringify({ code: status, message, data: null });
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function resolveFs(storagePath) {
  const normalised = `/${storagePath.split('/').filter(Boolean).join('/')}`;
  const target = path.resolve(ROOT, `.${normalised}`);
  if (!target.startsWith(ROOT)) throw new Error('path escape');
  return target;
}

function statEntry(storagePath, name, stat) {
  return {
    name,
    size: stat.isDirectory() ? 0 : stat.size,
    is_dir: stat.isDirectory(),
    modified: stat.mtime.toISOString(),
    created: stat.birthtime.toISOString(),
    sign: '',
    thumb: '',
    type: stat.isDirectory() ? 0 : 1,
    hashinfo: '',
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks);
  if ((req.headers['content-type'] ?? '').includes('application/json')) {
    try {
      return JSON.parse(raw.toString('utf8'));
    } catch {
      return {};
    }
  }
  return raw;
}

function authenticate(req) {
  const token = req.headers.authorization ?? '';
  if (token && token === API_TOKEN) return USERS[0];
  if (token && tokens.has(token)) return USERS.find((u) => u.id === tokens.get(token)) ?? null;
  return null;
}

/**
 * OpenList prefixes every filesystem path with the account's own base path
 * (`utils.JoinBasePath` is just `path.Join(basePath, reqPath)`). Reproducing it
 * here is what makes the "do not request /public/public/Notes" behaviour
 * testable.
 */
function joinBasePath(user, reqPath) {
  const base = (user?.base_path ?? '/').replace(/\/+$/, '');
  if (!base || base === '/') return reqPath;
  return base + (reqPath === '/' ? '' : reqPath);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const method = req.method ?? 'GET';

  try {
    if (pathname === '/ping') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('pong');
      return;
    }

    if (pathname === '/api/public/init_status') {
      if (!WITH_INIT_STATUS) return spa(res);
      return ok(res, { initialized: true });
    }
    if (pathname === '/api/public/settings') {
      return ok(res, { site_title: 'Mock OpenList', version: 'v4.0.0-mock', favicon: '' });
    }

    if (pathname === '/api/auth/login' && method === 'POST') {
      const body = await readBody(req);
      const user = USERS.find((u) => u.username === body.username && u.password === body.password);
      if (!user) return fail(res, 401, 'Invalid username or password');
      const token = `mock-${user.username}-${Date.now().toString(36)}`;
      tokens.set(token, user.id);
      console.log(`[mock-openlist] login ${user.username}`);
      return ok(res, { token });
    }

    const account = authenticate(req);
    /** The account that acts on this request: a real user, or the guest. */
    const user = account ?? (GUEST_ENABLED ? GUEST : null);

    if (pathname === '/api/me') {
      if (!user) return fail(res, 401, 'Guest user is disabled, login please');
      return ok(res, { ...user, otp: false, disabled: false });
    }
    if (pathname === '/api/auth/logout') {
      if (req.headers.authorization) tokens.delete(req.headers.authorization);
      return ok(res, null);
    }

    if (pathname.startsWith('/api/fs/')) {
      const action = pathname.slice('/api/fs/'.length);

      if (action === 'put' && method === 'PUT') {
        if (!user) return fail(res, 401, 'Guest user is disabled, login please');
        if (!canWrite(user)) return fail(res, 403, 'Permission denied');
        const raw = req.headers['file-path'] ?? '';
        const storagePath = joinBasePath(user, decodeURIComponent(raw));
        const target = resolveFs(storagePath);
        await fsp.mkdir(path.dirname(target), { recursive: true });
        const data = await readBody(req);
        await fsp.writeFile(target, data);
        console.log(`[mock-openlist] PUT ${storagePath} (${data.length} bytes)`);
        return ok(res, null);
      }

      if (action === 'mkdir' && method === 'POST') {
        if (!user) return fail(res, 401, 'Guest user is disabled, login please');
        if (!canWrite(user)) return fail(res, 403, 'Permission denied');
        const body = await readBody(req);
        await fsp.mkdir(resolveFs(joinBasePath(user, String(body.path ?? '/'))), { recursive: true });
        return ok(res, null);
      }

      if (action === 'list' && method === 'POST') {
        if (!user) return fail(res, 401, 'Guest user is disabled, login please');
        const body = await readBody(req);
        const storagePath = joinBasePath(user, String(body.path ?? '/'));
        const target = resolveFs(storagePath);
        let entries;
        try {
          entries = await fsp.readdir(target, { withFileTypes: true });
        } catch {
          return fail(res, 500, 'object not found');
        }
        const content = [];
        for (const entry of entries) {
          const stat = await fsp.stat(path.join(target, entry.name));
          content.push(statEntry(storagePath, entry.name, stat));
        }
        return ok(res, {
          content,
          total: content.length,
          readme: '',
          header: '',
          write: canWrite(user),
          provider: 'local',
        });
      }

      if (action === 'get' && method === 'POST') {
        if (!user) return fail(res, 401, 'Guest user is disabled, login please');
        const body = await readBody(req);
        const storagePath = joinBasePath(user, String(body.path ?? '/'));
        const target = resolveFs(storagePath);
        let stat;
        try {
          stat = await fsp.stat(target);
        } catch {
          return fail(res, 500, 'object not found');
        }
        const encoded = storagePath.split('/').map(encodeURIComponent).join('/');
        return ok(res, {
          ...statEntry(storagePath, path.basename(target), stat),
          raw_url: `http://127.0.0.1:${PORT}/p${encoded}`,
          readme: '',
          provider: 'local',
          related: [],
        });
      }

      if (action === 'remove' && method === 'POST') {
        if (!user) return fail(res, 401, 'Guest user is disabled, login please');
        if (!canWrite(user)) return fail(res, 403, 'Permission denied');
        const body = await readBody(req);
        const dir = joinBasePath(user, String(body.dir ?? '/'));
        for (const name of body.names ?? []) {
          await fsp.rm(resolveFs(`${dir}/${name}`), { recursive: true, force: true });
        }
        return ok(res, null);
      }

      if (action === 'rename' && method === 'POST') {
        if (!user) return fail(res, 401, 'Guest user is disabled, login please');
        const body = await readBody(req);
        const source = resolveFs(String(body.path));
        await fsp.rename(source, path.join(path.dirname(source), String(body.name)));
        return ok(res, null);
      }

      if (action === 'move' && method === 'POST') {
        if (!user) return fail(res, 401, 'Guest user is disabled, login please');
        const body = await readBody(req);
        for (const name of body.names ?? []) {
          const from = resolveFs(`${body.src_dir ?? '/'}/${name}`);
          const to = resolveFs(`${body.dst_dir ?? '/'}/${name}`);
          await fsp.mkdir(path.dirname(to), { recursive: true });
          await fsp.rename(from, to);
        }
        return ok(res, { message: 'Move operations completed immediately' });
      }
    }

    if (pathname.startsWith('/p/')) {
      const storagePath = decodeURIComponent(pathname.slice(2));
      const target = resolveFs(storagePath);
      try {
        const stat = await fsp.stat(target);
        if (stat.isDirectory()) return fail(res, 400, 'is a directory');
        const stream = fs.createReadStream(target);
        res.writeHead(200, {
          'Content-Type': MIME[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
          'Content-Length': stat.size,
        });
        stream.pipe(res);
        return;
      } catch {
        return fail(res, 404, 'not found');
      }
    }

    // Anything else is a page request as far as the mock is concerned.
    return spa(res);
  } catch (err) {
    console.error('[mock-openlist] error:', err);
    return fail(res, 500, err instanceof Error ? err.message : String(err));
  }
});

await fsp.mkdir(ROOT, { recursive: true });
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-openlist] listening on http://127.0.0.1:${PORT}`);
  console.log(`[mock-openlist] storage root: ${ROOT}`);
  console.log(
    '[mock-openlist] /api/public/init_status: ' +
      (WITH_INIT_STATUS ? 'present (newer build)' : 'absent, SPA fallback (v4.2.6 behaviour)'),
  );
  console.log('[mock-openlist] accounts: admin/admin (admin), writer/writer; API token: ' + API_TOKEN);
});
