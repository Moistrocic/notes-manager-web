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
  { id: 1, username: 'admin', password: 'admin', role: 2, permission: 0xffff },
  { id: 2, username: 'writer', password: 'writer', role: 0, permission: (1 << 3) | (1 << 4) | (1 << 7) },
];
const API_TOKEN = 'mock-api-token';

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

    if (pathname === '/api/public/init_status') return ok(res, { initialized: true });
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

    const user = authenticate(req);

    if (pathname === '/api/me') {
      if (!user) return fail(res, 401, 'not logged in');
      return ok(res, { ...user, base_path: '/', otp: false, disabled: false });
    }
    if (pathname === '/api/auth/logout') {
      if (req.headers.authorization) tokens.delete(req.headers.authorization);
      return ok(res, null);
    }

    if (pathname.startsWith('/api/fs/')) {
      const action = pathname.slice('/api/fs/'.length);

      if (action === 'put' && method === 'PUT') {
        if (!user) return fail(res, 401, 'Guest user is disabled, login please');
        const raw = req.headers['file-path'] ?? '';
        const storagePath = decodeURIComponent(raw);
        const target = resolveFs(storagePath);
        await fsp.mkdir(path.dirname(target), { recursive: true });
        const data = await readBody(req);
        await fsp.writeFile(target, data);
        console.log(`[mock-openlist] PUT ${storagePath} (${data.length} bytes)`);
        return ok(res, null);
      }

      if (action === 'mkdir' && method === 'POST') {
        if (!user) return fail(res, 401, 'Guest user is disabled, login please');
        const body = await readBody(req);
        await fsp.mkdir(resolveFs(String(body.path ?? '/')), { recursive: true });
        return ok(res, null);
      }

      if (action === 'list' && method === 'POST') {
        const body = await readBody(req);
        const storagePath = String(body.path ?? '/');
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
        return ok(res, { content, total: content.length, readme: '', header: '', write: Boolean(user), provider: 'local' });
      }

      if (action === 'get' && method === 'POST') {
        const body = await readBody(req);
        const storagePath = String(body.path ?? '/');
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
        const body = await readBody(req);
        for (const name of body.names ?? []) {
          await fsp.rm(resolveFs(`${body.dir ?? '/'}/${name}`), { recursive: true, force: true });
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

    return fail(res, 404, `not found: ${method} ${pathname}`);
  } catch (err) {
    console.error('[mock-openlist] error:', err);
    return fail(res, 500, err instanceof Error ? err.message : String(err));
  }
});

await fsp.mkdir(ROOT, { recursive: true });
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[mock-openlist] listening on http://127.0.0.1:${PORT}`);
  console.log(`[mock-openlist] storage root: ${ROOT}`);
  console.log('[mock-openlist] accounts: admin/admin (admin), writer/writer; API token: ' + API_TOKEN);
});
