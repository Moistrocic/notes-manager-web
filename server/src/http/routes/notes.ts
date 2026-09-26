import express, { Router, type Response } from 'express';
import type { Services } from '../../services.js';
import { createLogger } from '../../logger.js';
import { handler, requireAuth } from '../middleware.js';
import { baseName } from '../../storage/types.js';
import { kindOf, sanitiseFileName, stripExtension, type NotePatch } from '../../notes/repository.js';

const log = createLogger('routes:notes');

/**
 * Raw-body uploads: the browser sends exactly the file, and a note's pictures
 * travel the same way. Generous next to a real .md file, small enough that a
 * runaway body cannot fill the disk through this one route.
 */
const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((v) => String(v));
}

/**
 * The uploaded text without a front matter block.
 *
 * A note's title, tags and flags live in front matter, and the repository
 * writes its own when it saves. Keeping the uploaded block would bury one
 * inside the other.
 */
function stripFrontMatter(text: string): string {
  const match = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  return match ? text.slice(match[0].length) : text.replace(/^\uFEFF/, '');
}

/** What a browser is told a file is, by extension. */
const CONTENT_TYPES: Record<string, string> = {
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.zip': 'application/zip',
};

function contentTypeFor(name: string): string {
  const idx = name.lastIndexOf('.');
  const extension = idx > 0 ? name.slice(idx).toLowerCase() : '';
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

/**
 * The headers that hand a file's own bytes back.
 *
 * Shared with the blog, which serves the same kind of thing to the public with
 * a different cache lifetime. The bytes come from the API's own origin, so
 * nothing inside them may act as a document: an SVG that scripts on load would
 * otherwise run with the visitor's session (or, on the blog, the site's)
 * behind it.
 */
export function fileResponseHeaders(res: Response, name: string, cacheControl: string): void {
  res.setHeader('Content-Type', contentTypeFor(name));
  res.setHeader('Content-Disposition', dispositionHeader('inline', name));
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (contentTypeFor(name) === 'image/svg+xml') {
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  }
}

/**
 * The `Content-Disposition` value for a file name.
 *
 * RFC 5987, so a Chinese name survives a header that is latin-1 by definition:
 * the plain `filename` is the ASCII-safe fallback, and `filename*` carries the
 * real one.
 */
function dispositionHeader(kind: 'inline' | 'attachment', name: string): string {
  return `${kind}; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export function notesRoutes(services: Services): Router {
  const router = Router();
  router.use(requireAuth);

// A guest browses. On OpenList that is enforced by the folder's permissions; the
// notes on this server's own disk have none, so writing is refused here. It is a
// rule about the session rather than about a route, so it sits above all of them
// instead of being remembered in each one.
router.use((req, res, next) => {
  const guest = req.session?.guest === true && req.session.provider === 'local';
  if (!guest || req.method === 'GET' || req.method === 'HEAD') {
    next();
    return;
  }
  res.status(403).json({ error: { message: '游客只能查看，不能修改', code: 'guest_readonly' } });
});

  /* ------------------------------ collections ---------------------------- */

  router.get(
    '/',
    handler(async (req, res) => {
      const user = req.session;
      const query = String(req.query.q ?? '').trim().toLowerCase();
      const tagFilter = String(req.query.tag ?? '').trim();
      const folderFilter = req.query.folder === undefined ? undefined : String(req.query.folder);
      const favoriteOnly = String(req.query.favorite ?? '') === 'true';
      const sort = String(req.query.sort ?? 'updated');

      let notes = await services.notes.list(user);

      if (favoriteOnly) notes = notes.filter((n) => n.favorite);
      if (tagFilter) notes = notes.filter((n) => n.tags.some((t) => t.toLowerCase() === tagFilter.toLowerCase()));
      if (folderFilter !== undefined) {
        const folder = folderFilter === '/' ? '' : folderFilter.replace(/^\//, '');
        notes = notes.filter((n) => n.folder === folder);
      }
      if (query) {
        notes = notes.filter((n) => {
          if (n.title.toLowerCase().includes(query)) return true;
          if (n.tags.some((t) => t.toLowerCase().includes(query))) return true;
          if (n.excerpt.toLowerCase().includes(query)) return true;
          return n.content ? n.content.toLowerCase().includes(query) : false;
        });
      }

      notes.sort((a, b) => {
        const pin = Number(b.pinned) - Number(a.pinned);
        if (pin !== 0) return pin;
        switch (sort) {
          case 'created':
            return Date.parse(b.created) - Date.parse(a.created);
          case 'title':
            return a.title.localeCompare(b.title, 'zh-Hans-CN');
          case 'words':
            return b.wordCount - a.wordCount;
          default:
            return Date.parse(b.updated) - Date.parse(a.updated);
        }
      });

      const [stats, tags, folders, capabilities] = await Promise.all([
        services.notes.stats(user),
        services.notes.tags(user),
        services.notes.folders(user),
        services.notes.capabilities(user),
      ]);

      const summaries = notes.map(({ content: _content, ...rest }) => rest);
      res.json({
        notes: summaries,
        stats,
        tags,
        folders,
        capabilities,
        user: user
          ? {
              username: user.username,
              provider: user.provider,
              role: user.role,
              guest: Boolean(user.openlistGuest || user.guest),
              permissions: user.permissions ?? null,
              basePath: user.openlistBasePath ?? null,
            }
          : null,
      });
    }),
  );

  router.get(
    '/tags',
    handler(async (req, res) => {
      res.json({ tags: await services.notes.tags(req.session) });
    }),
  );

  router.get(
    '/folders',
    handler(async (req, res) => {
      res.json({ folders: await services.notes.folders(req.session) });
    }),
  );

  router.post(
    '/folders',
    handler(async (req, res) => {
      const body = (req.body ?? {}) as { path?: string };
      const created = await services.notes.createFolder(req.session, String(body.path ?? ''));
      log.info(`folder created: ${created}`);
      res.status(201).json({ folder: created, folders: await services.notes.folders(req.session) });
    }),
  );

  router.post(
    '/folders/rename',
    handler(async (req, res) => {
      const body = (req.body ?? {}) as { path?: string; name?: string };
      const path = await services.notes.renameFolder(req.session, String(body.path ?? ''), String(body.name ?? ''));
      log.info(`folder renamed: ${body.path} -> ${path}`);
      res.json({ ok: true, path, folders: await services.notes.folders(req.session) });
    }),
  );

  /**
   * Moves a folder under another folder. `target` is the destination, and an
   * absent value means the notes root.
   */
  router.post(
    '/folders/move',
    handler(async (req, res) => {
      const body = (req.body ?? {}) as { path?: string; target?: string };
      const target = typeof body.target === 'string' ? body.target : '';
      const path = await services.notes.moveFolder(req.session, String(body.path ?? ''), target);
      log.info(`folder moved: ${body.path} -> ${path}`);
      res.json({ ok: true, path, folders: await services.notes.folders(req.session) });
    }),
  );

  router.delete(
    '/folders',
    handler(async (req, res) => {
      const target = String(req.query.path ?? '');
      // Moved to the trash rather than deleted, so it can be recovered from the
      // same place the notes go.
      const { trashPath } = await services.notes.deleteFolder(req.session, target);
      log.info(`folder moved to trash: ${target} -> ${trashPath}`);
      res.json({ ok: true, trashed: true, folders: await services.notes.folders(req.session) });
    }),
  );

  router.get(
    '/trash',
    handler(async (req, res) => {
      const trashed = await services.notes.listTrash(req.session);
      // Folders are listed beside the notes so one dialog can show everything
      // waiting to be restored or thrown away.
      const folders = await services.notes.listFolderTrash(req.session);
      res.json({
        notes: trashed.map(({ content: _content, ...rest }) => rest),
        folders: folders.map((folder) => ({
          path: folder.path,
          name: folder.name,
          originalPath: folder.originalPath,
          deletedAt: folder.deletedAt,
        })),
      });
    }),
  );

  router.delete(
    '/trash/folders',
    handler(async (req, res) => {
      const target = String(req.query.path ?? '');
      await services.notes.purgeTrashedFolder(req.session, target);
      log.info(`trashed folder purged: ${target}`);
      res.json({ ok: true });
    }),
  );

  router.post(
    '/trash/folders/restore',
    handler(async (req, res) => {
      const body = (req.body ?? {}) as { path?: string };
      const restored = await services.notes.restoreFolder(req.session, String(body.path ?? ''));
      log.info(`folder restored: ${restored}`);
      res.json({ ok: true, path: restored, folders: await services.notes.folders(req.session) });
    }),
  );

  router.post(
    '/trash/empty',
    handler(async (req, res) => {
      const removed = await services.notes.emptyTrash(req.session);
      res.json({ ok: true, removed });
    }),
  );

  /* -------------------------------- single ------------------------------- */

  /**
   * A file's bytes, exactly as they are stored.
   *
   * This is what a picture in a note points at: `![x](img/a.png)` becomes a
   * request for the storage path the server actually keeps. Inline rather than
   * an attachment, because the browser is rendering it rather than saving it.
   *
   * Registered before `/:id`, which would otherwise read "file" as a note id.
   */
  router.get(
    '/file',
    handler(async (req, res) => {
      const { path: storagePath, data } = await services.notes.readBinary(req.session, String(req.query.path ?? ''));
      fileResponseHeaders(res, baseName(storagePath), 'private, max-age=60');
      res.send(Buffer.from(data));
    }),
  );

  router.post(
    '/',
    handler(async (req, res) => {
      const body = (req.body ?? {}) as {
        title?: string;
        content?: string;
        tags?: unknown;
        folder?: string;
        pinned?: boolean;
        favorite?: boolean;
        color?: string | null;
      };
      const note = await services.notes.create(req.session, {
        title: body.title,
        content: typeof body.content === 'string' ? body.content : '',
        tags: asStringArray(body.tags),
        folder: body.folder,
        pinned: body.pinned,
        favorite: body.favorite,
        color: body.color ?? undefined,
      });
      res.status(201).json({ note });
    }),
  );

  /**
   * The entry as a file.
   *
   * Deliberately a download rather than JSON: the point is to get the file the
   * server actually stores, front matter and all, so it can be dropped into
   * another editor or handed to someone else. A picture or any other file
   * downloads as itself, under the name it has on disk.
   */
  router.get(
    '/:id/download',
    handler(async (req, res) => {
      const note = await services.notes.get(req.session, String(req.params.id));
      if (note.kind !== 'note') {
        const { path: storagePath, data } = await services.notes.readBinary(req.session, note.path);
        const name = baseName(storagePath);
        res.setHeader('Content-Type', contentTypeFor(name));
        res.setHeader('Content-Disposition', dispositionHeader('attachment', name));
        res.send(Buffer.from(data));
        return;
      }
      const name = `${sanitiseFileName(note.title, 'note')}.md`;
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', dispositionHeader('attachment', name));
      res.send(note.content);
    }),
  );

  /**
   * Creates a note from an uploaded file.
   *
   * The bytes are the body and the metadata rides in headers, the same shape the
   * font upload uses: the client sends exactly the file, and no multipart parser
   * is needed for one field.
   *
   * Markdown (and .txt) becomes a note with front matter, because that is where
   * tags, pins and the note's own id live. Everything else - a picture, most
   * obviously - is stored byte for byte, under the name it arrived with, and an
   * empty file is a perfectly good file.
   */
  router.post(
    '/upload',
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
    handler(async (req, res) => {
      // `express.json()` runs before this router, so a body labelled
      // application/json has already been consumed and parsed by the time the
      // raw parser here is reached - the browser reports exactly that type for
      // a .json file. Writing the parsed value back would not be the file, and
      // writing nothing would be a silent empty file, so it is refused until
      // the client sends the bytes as application/octet-stream.
      if (req.body !== undefined && !Buffer.isBuffer(req.body)) {
        res.status(415).json({
          error: { message: '请以原始字节上传（Content-Type 不能是 application/json）', code: 'unsupported_upload' },
        });
        return;
      }
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);

      // Header values are latin-1, so the client percent-encodes anything
      // outside ASCII - a Chinese file name, most obviously.
      const header = (name: string) => {
        const value = req.get(name);
        if (typeof value !== 'string' || !value.trim()) return '';
        try {
          return decodeURIComponent(value.trim());
        } catch {
          return value.trim();
        }
      };
      const rawName = header('X-Note-Filename') || header('X-Font-Filename') || 'note.md';
      const name = sanitiseFileName(rawName, 'note.md');
      const folder = header('X-Note-Folder') || undefined;

      if (kindOf(name) === 'note') {
        // The name the user chose is the title: a file handed over as
        // `周报.md` is called 周报, and a heading inside it does not get to
        // rename it - the file name is what the tree and the disk agree on.
        const text = stripFrontMatter(body.toString('utf8'));
        const stem = stripExtension(name) || 'note';
        const note = await services.notes.create(req.session, {
          title: sanitiseFileName(header('X-Note-Title') || stem, stem),
          content: text,
          folder,
          fileName: name,
        });
        log.info(`note uploaded: ${rawName} -> ${note.path}`);
        res.status(201).json({ note });
        return;
      }

      const note = await services.notes.createFile(req.session, {
        name,
        folder,
        data: body,
        contentType: req.get('content-type') || contentTypeFor(name),
      });
      log.info(`file uploaded: ${rawName} -> ${note.path}`);
      res.status(201).json({ note });
    }),
  );

  router.get(
    '/:id',
    handler(async (req, res) => {
      res.json({ note: await services.notes.get(req.session, String(req.params.id)) });
    }),
  );

  router.put(
    '/:id',
    handler(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const patch: NotePatch = {};
      if (typeof body.title === 'string') patch.title = body.title;
      if (typeof body.content === 'string') patch.content = body.content;
      if (body.tags !== undefined) patch.tags = asStringArray(body.tags) ?? [];
      if (typeof body.pinned === 'boolean') patch.pinned = body.pinned;
      if (typeof body.favorite === 'boolean') patch.favorite = body.favorite;
      if (body.color === null || typeof body.color === 'string') patch.color = body.color as string | null;
      if (typeof body.folder === 'string') patch.folder = body.folder;
      if (typeof body.blog === 'boolean') patch.blog = body.blog;
      const note = await services.notes.update(req.session, String(req.params.id), patch);
      res.json({ note });
    }),
  );

  router.delete(
    '/:id',
    handler(async (req, res) => {
      const permanent = String(req.query.permanent ?? '') === 'true';
      const result = await services.notes.remove(req.session, String(req.params.id), permanent);
      res.json({ ok: true, ...result });
    }),
  );

  router.post(
    '/:id/restore',
    handler(async (req, res) => {
      const note = await services.notes.restore(req.session, String(req.params.id));
      res.json({ note });
    }),
  );

  return router;
}
