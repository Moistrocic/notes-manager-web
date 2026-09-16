import { Router } from 'express';
import { createLogger } from '../../logger.js';
import { handler } from '../middleware.js';
import type { Services } from '../../services.js';

const log = createLogger('routes:background');

/**
 * The administrator's default background.
 *
 * Deliberately not behind requireAuth: the sign-in screen shows the background
 * too, and it is the one thing on the page that has to arrive before anybody
 * has a session. It exposes a file the administrator chose to publish, and
 * nothing else - the file has to be one the store has already listed.
 */
export function backgroundRoutes(services: Services): Router {
  const router = Router();

  router.get(
    '/',
    handler(async (_req, res) => {
      const files = services.backgrounds.list();
      const picked = services.backgrounds.pick();
      res.json({
        configured: Boolean(picked),
        file: picked?.name ?? null,
        kind: picked?.kind ?? null,
        bytes: picked?.bytes ?? 0,
        available: files.map((f) => ({ name: f.name, kind: f.kind, bytes: f.bytes })),
        note: services.backgrounds.manifest().note ?? null,
      });
    }),
  );

  router.get(
    '/file',
    handler(async (req, res) => {
      const wanted = typeof req.query.name === 'string' && req.query.name ? req.query.name : null;
      const picked = services.backgrounds.pick();
      const file = wanted ? services.backgrounds.list().find((f) => f.name === wanted) : picked;
      if (!file) {
        res.status(404).json({ error: { message: '没有可用的背景', code: 'no_background' } });
        return;
      }
      const absolute = services.backgrounds.resolve(file.name);
      if (!absolute) {
        res.status(404).json({ error: { message: '背景文件不存在', code: 'no_background' } });
        return;
      }
      res.setHeader('Content-Type', services.backgrounds.contentType(file));
      // Long-lived but revalidated: an administrator replacing the file should
      // not have to wonder why nobody sees the new one.
      res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
      log.info(`serving background ${file.name}`);
      res.sendFile(absolute);
    }),
  );

  return router;
}
