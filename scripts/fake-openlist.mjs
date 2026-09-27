/**
 * A stand-in for OpenList, faithful to the handlers this project talks to.
 *
 * Everything here is copied from the server's own source rather than guessed:
 *
 *  - `/api/fs/rename` takes a *bare* file name (a path is refused:
 *    `checkRelativePath`), refuses a taken destination unless `overwrite`, and
 *    is synchronous (fsmanage.go FsRename -> fs.Rename).
 *  - `/api/fs/put` is PutDirectly: synchronous, and it fails when the parent
 *    folder is missing (the driver ends in `os.Create`), and refuses an
 *    existing file when `Overwrite: false` with `file exists` (fsup.go).
 *  - `/api/fs/mkdir` is op.MakeDir: an existing *folder* is fine, a *file* in
 *    the way is not, and missing parents are created on the way down.
 *  - `/api/fs/move` only *schedules* the work: FsMove creates a task and
 *    answers "Successfully created N move task(s)" before anything has moved
 *    ("Create all tasks immediately without any synchronous validation"). That
 *    is the behaviour the app has to cope with, so it is the default here.
 *  - every request path is joined onto the account's own base path
 *    (`user.JoinPath` -> `utils.JoinBasePath`: `stdpath.Join(base, reqPath)`).
 *    With `basePath: "/public"` this is an account jailed to `/public`, and
 *    `/api/me` reports that - which is how a client is supposed to find out.
 *
 * Errors follow OpenList's convention: HTTP 200 with `{ code, message }`
 * (server/common/common.go ErrorResp), except 401, which is a real 401.
 *
 * Every request is recorded, so a test can assert what the app actually sent -
 * a rename, a put, or a remove that was never asked for.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

function send(res, body, status = 200) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}
const ok = (res, data = null) => send(res, { code: 200, message: 'success', data });
const fail = (res, code, message) => send(res, { code, message }, code === 401 ? 401 : 200);

/**
 * Starts the fake and returns handles for a test: where it listens, what it was
 * asked to do, and what its storage looks like now.
 *
 * @param {object} options
 * @param {string} options.root      directory the fake backend keeps files in
 * @param {boolean} [options.asyncMove] true: `/api/fs/move` schedules the work
 * @param {number} [options.moveDelayMs] how long the scheduled move waits
 * @param {number} [options.port]   0 lets the OS pick one
 * @param {string} [options.basePath] the account's base path; "/" (the default)
 *   means every request path is used as written
 * @param {boolean} [options.meUnauthorized] make `/api/me` answer 401, the way an
 *   old build (or a token that cannot read itself) would
 */
export async function startFakeOpenList({
  root,
  asyncMove = true,
  moveDelayMs = 700,
  port = 0,
  basePath = '/',
  meUnauthorized = false,
} = {}) {
  fs.mkdirSync(root, { recursive: true });
  const accountBase = basePath && basePath !== '' ? basePath : '/';
  /** What the account does with a request path: join it onto its base path. */
  const userPath = (p) => path.posix.join(accountBase, String(p ?? '/'));
  /** Every request, in order: method, path, JSON body, upload headers. */
  const requests = [];
  /** Moves the background task actually performed, with the moment it did. */
  const moves = [];

  const local = (p) => path.join(root, ...String(p ?? '/').split('/').filter(Boolean));
  const exists = (p) => fs.existsSync(local(p));

  const entryFor = (target, name) => {
    const st = fs.statSync(target);
    return {
      name,
      size: st.isDirectory() ? 0 : st.size,
      is_dir: st.isDirectory(),
      modified: st.mtime.toISOString(),
      created: st.birthtime.toISOString(),
    };
  };

  const walk = (dir, out) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const target = path.join(dir, name);
      out.push('/' + path.relative(root, target).split(path.sep).join('/'));
      if (fs.statSync(target).isDirectory()) walk(target, out);
    }
    return out;
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks);
    let json = null;
    try {
      json = raw.length ? JSON.parse(raw.toString('utf8')) : null;
    } catch {
      json = null;
    }
    requests.push({
      method: req.method,
      path: url.pathname,
      body: json,
      filePath: req.headers['file-path'] ? decodeURIComponent(String(req.headers['file-path'])) : null,
      overwrite: req.headers.overwrite === undefined ? null : String(req.headers.overwrite),
    });

    // Public settings, and the two download links: exactly as on the real
    // server, none of them asks for a token.
    if (url.pathname === '/api/public/settings') return ok(res, { site_title: 'Fake OpenList', version: 'v4.2.6' });
    if (url.pathname === '/api/public/init_status') return ok(res, { initialized: true });
    if (url.pathname.startsWith('/d/') || url.pathname.startsWith('/p/')) {
      // A download link names the file the way the account asked for it, so the
      // base path applies here too.
      const target = local(userPath(decodeURIComponent(url.pathname.slice(3))));
      if (!fs.existsSync(target)) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      res.end(fs.readFileSync(target));
      return;
    }

    if (!req.headers.authorization) return fail(res, 401, 'not logged in');

    switch (url.pathname) {
      case '/api/me': {
        // What the client needs to strip its absolute root down to this
        // account's own view of it.
        if (meUnauthorized) return fail(res, 401, 'not logged in');
        return ok(res, { id: 1, username: 'tester', base_path: accountBase, role: 0, permission: 0 });
      }
      case '/api/fs/list': {
        const target = local(userPath(json?.path));
        if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) return fail(res, 500, 'object not found');
        const content = fs.readdirSync(target).map((name) => entryFor(path.join(target, name), name));
        return ok(res, { content, total: content.length, write: true, provider: 'local' });
      }
      case '/api/fs/get': {
        const target = local(userPath(json?.path));
        if (!fs.existsSync(target)) return fail(res, 500, 'object not found');
        return ok(res, {
          ...entryFor(target, path.basename(target)),
          // The link is handed back the way the account sees the file; the
          // download route joins the base path on again.
          raw_url: '/d/' + encodeURIComponent(json.path),
        });
      }
      case '/api/fs/mkdir': {
        const target = local(userPath(json?.path));
        // op.MakeDir checks first: an existing folder is not an error, a file
        // in the way is, and missing parents are created on the way down.
        if (fs.existsSync(target)) {
          if (fs.statSync(target).isDirectory()) return ok(res);
          return fail(res, 500, 'file exists');
        }
        fs.mkdirSync(target, { recursive: true });
        return ok(res);
      }
      case '/api/fs/put': {
        const target = local(userPath(req.headers['file-path'] ? decodeURIComponent(String(req.headers['file-path'])) : '/'));
        const overwrite = String(req.headers.overwrite ?? 'true') !== 'false';
        if (!overwrite && fs.existsSync(target)) return fail(res, 403, 'file exists');
        // PutDirectly ends in os.Create: a missing parent folder fails.
        if (!fs.existsSync(path.dirname(target))) return fail(res, 500, 'parent directory not found');
        fs.writeFileSync(target, raw);
        return ok(res);
      }
      case '/api/fs/remove': {
        for (const name of json?.names ?? []) {
          const target = local(userPath(path.posix.join(json.dir ?? '/', name)));
          if (!fs.existsSync(target)) continue;
          // A non-empty folder needs the recursive task flag on the real
          // server; the app never removes one, so neither does this.
          if (fs.statSync(target).isDirectory() && fs.readdirSync(target).length > 0) {
            return fail(res, 500, 'directory not empty');
          }
          fs.rmSync(target, { recursive: false });
        }
        return ok(res);
      }
      case '/api/fs/rename': {
        const source = local(userPath(json?.path));
        const name = String(json?.name ?? '');
        if (!name || /[\\/]/.test(name) || name === '.' || name === '..') return fail(res, 403, 'relative path');
        if (!fs.existsSync(source)) return fail(res, 500, 'object not found');
        const destination = path.join(path.dirname(source), name);
        if (destination !== source && fs.existsSync(destination) && !json?.overwrite) {
          return fail(res, 403, `file [${name}] exists`);
        }
        fs.renameSync(source, destination);
        return ok(res);
      }
      case '/api/fs/move': {
        const names = json?.names ?? [];
        const srcDir = String(json?.src_dir ?? '/');
        const dstDir = String(json?.dst_dir ?? '/');
        // The destination is checked in the request thread, before any task is
        // created (fsmanage.go FsMove) - the move itself is not.
        if (!json?.overwrite) {
          for (const name of names) {
            if (exists(userPath(path.posix.join(dstDir, name)))) return fail(res, 403, `file [${name}] exists`);
          }
        }
        const doMove = () => {
          for (const name of names) {
            const source = local(userPath(path.posix.join(srcDir, name)));
            const destination = local(userPath(path.posix.join(dstDir, name)));
            if (!fs.existsSync(source)) continue;
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.renameSync(source, destination);
            moves.push({ source, destination, at: Date.now() });
          }
        };
        if (asyncMove) {
          // The real handler answers before the task has run.
          setTimeout(doMove, moveDelayMs);
          return ok(res, { message: `Successfully created ${names.length} move task(s)` });
        }
        doMove();
        return ok(res, { message: 'Move operations completed immediately' });
      }
      default:
        return fail(res, 404, 'not found');
    }
  });

  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
  const actualPort = server.address().port;

  return {
    url: `http://127.0.0.1:${actualPort}`,
    port: actualPort,
    root,
    requests,
    moves,
    /** Forgets the requests so far, for a test that only cares about the next one. */
    reset: () => {
      requests.length = 0;
      moves.length = 0;
    },
    /** Whether the backend has that path (OpenList path, e.g. `/notes/a.md`). */
    has: (p) => fs.existsSync(local(p)),
    /** The bytes of one file, as OpenList stores them. */
    read: (p) => fs.readFileSync(local(p), 'utf8'),
    stat: (p) => fs.statSync(local(p)),
    /** Every file in the backend, paths relative to the fake root. */
    files: () => walk(root, []).filter((p) => fs.statSync(local(p)).isFile()),
    /** Every file and folder, paths relative to the fake root. */
    entries: () => walk(root, []),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}
