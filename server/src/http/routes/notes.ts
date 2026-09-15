import express, { Router } from 'express';
import type { Services } from '../../services.js';
import { createLogger } from '../../logger.js';
import { handler, requireAuth } from '../middleware.js';
import type { NotePatch } from '../../notes/repository.js';

const log = createLogger('routes:notes');

/** Uploads are notes, so they are small. Generous next to a real .md file. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((v) => String(v));
}

/** A file name a browser will accept, on any platform. */
function safeFileName(raw: string): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  return cleaned.slice(0, 80) || 'note';
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

/** The first heading, which is a better title than a file name when present. */
function firstHeading(text: string): string | null {
  const match = /^#{1,2}\s+(.+)$/m.exec(text);
  return match ? match[1].trim().slice(0, 120) : null;
}

export function notesRoutes(services: Services): Router {
  const router = Router();
  router.use(requireAuth);

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
              guest: Boolean(user.openlistGuest),
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
   * The note as a plain .md file.
   *
   * Deliberately a download rather than JSON: the point is to get the file the
   * server actually stores, front matter and all, so it can be dropped into
   * another editor or handed to someone else.
   */
  router.get(
    '/:id/download',
    handler(async (req, res) => {
      const note = await services.notes.get(req.session, String(req.params.id));
      const name = `${safeFileName(note.title)}.md`;
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      // RFC 5987, so a Chinese title survives the header.
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      );
      res.send(note.content);
    }),
  );

  /**
   * Creates a note from an uploaded file.
   *
   * The bytes are the body and the metadata rides in headers, the same shape the
   * font upload uses: the client sends exactly the file, and no multipart parser
   * is needed for one field.
   */
  router.post(
    '/upload',
    express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES }),
    handler(async (req, res) => {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (body.length === 0) {
        res.status(400).json({ error: { message: '上传的文件是空的', code: 'empty_upload' } });
        return;
      }

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
      const text = stripFrontMatter(body.toString('utf8'));
      const title = header('X-Note-Title') || firstHeading(text) || safeFileName(rawName.replace(/\.md$/i, ''));
      const note = await services.notes.create(req.session, {
        title: safeFileName(title),
        content: text,
        folder: header('X-Note-Folder') || undefined,
      });

      log.info(`note uploaded: ${rawName} -> ${note.id}`);
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
