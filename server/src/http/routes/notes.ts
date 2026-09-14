import { Router } from 'express';
import type { Services } from '../../services.js';
import { createLogger } from '../../logger.js';
import { handler, requireAuth } from '../middleware.js';
import type { NotePatch } from '../../notes/repository.js';

const log = createLogger('routes:notes');

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((v) => String(v));
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

      const [stats, tags, folders] = await Promise.all([
        services.notes.stats(user),
        services.notes.tags(user),
        services.notes.folders(user),
      ]);

      const summaries = notes.map(({ content: _content, ...rest }) => rest);
      res.json({ notes: summaries, stats, tags, folders });
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

  router.delete(
    '/folders',
    handler(async (req, res) => {
      const target = String(req.query.path ?? '');
      await services.notes.deleteFolder(req.session, target);
      log.info(`folder removed: ${target}`);
      res.json({ ok: true, folders: await services.notes.folders(req.session) });
    }),
  );

  router.get(
    '/trash',
    handler(async (req, res) => {
      const trashed = await services.notes.listTrash(req.session);
      res.json({ notes: trashed.map(({ content: _content, ...rest }) => rest) });
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
