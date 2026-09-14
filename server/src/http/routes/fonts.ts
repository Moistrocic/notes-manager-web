import express, { Router } from 'express';
import { MAX_FONT_BYTES } from '../../fonts/store.js';
import { createLogger } from '../../logger.js';
import { handler, requireAdmin, requireAuth } from '../middleware.js';
import type { Services } from '../../services.js';

const log = createLogger('routes:fonts');

/**
 * Font management.
 *
 * Uploads are sent as a raw body with the metadata in headers rather than as
 * multipart form data: the browser sends exactly the bytes we store, and the
 * server needs no multipart parser for a single file field.
 */
export function fontRoutes(services: Services): Router {
  const router = Router();

  router.get(
    '/',
    requireAuth,
    handler(async (_req, res) => {
      res.json(services.fonts.list());
    }),
  );

  // The @font-face source. Same origin, so the browser sends the session cookie.
  router.get(
    '/:id/file',
    requireAuth,
    handler(async (req, res) => {
      const record = services.fonts.get(String(req.params.id));
      if (!record) {
        res.status(404).json({ error: { message: 'Font not found', code: 'not_found' } });
        return;
      }
      res.setHeader('Content-Type', services.fonts.contentType(record));
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      res.sendFile(services.fonts.filePath(record));
    }),
  );

  router.post(
    '/',
    requireAdmin,
    express.raw({ type: () => true, limit: MAX_FONT_BYTES + 1024 }),
    handler(async (req, res) => {
      const body = req.body as Buffer | undefined;
      if (!body || !Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: { message: 'No font data received', code: 'empty_body' } });
        return;
      }
      const decode = (value: unknown): string => {
        if (typeof value !== 'string') return '';
        try {
          return decodeURIComponent(value);
        } catch {
          return value;
        }
      };
      const fileName = decode(req.headers['x-font-filename']) || 'font.woff2';
      const name = decode(req.headers['x-font-name']) || fileName.replace(/\.[^.]+$/, '');

      try {
        const font = services.fonts.add({ name, fileName, data: body });
        res.status(201).json({ font, ...services.fonts.list() });
      } catch (err) {
        res.status(400).json({ error: { message: (err as Error).message, code: 'invalid_font' } });
      }
    }),
  );

  router.delete(
    '/:id',
    requireAdmin,
    handler(async (req, res) => {
      const removed = services.fonts.remove(String(req.params.id));
      if (!removed) {
        res.status(404).json({ error: { message: 'Font not found', code: 'not_found' } });
        return;
      }
      log.info(`font ${String(req.params.id)} deleted`);
      res.json({ ok: true, ...services.fonts.list() });
    }),
  );

  router.put(
    '/selection',
    requireAdmin,
    handler(async (req, res) => {
      const body = (req.body ?? {}) as { sans?: string; mono?: string };
      services.fonts.select({ sans: body.sans, mono: body.mono });
      res.json(services.fonts.list());
    }),
  );

  return router;
}
