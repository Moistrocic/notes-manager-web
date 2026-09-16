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
 * has a session. It is how the layer learns what to show and how to show it -
 * the file it may load has to be one the store already listed, and the rest is
 * the administrator's choices about framing and darkness.
 */
export function backgroundRoutes(services: Services): Router {
  const router = Router();

  router.get(
    '/',
    handler(async (_req, res) => {
      const settings = services.settings.effective().background;
      const files = services.backgrounds.list();
      const file = services.backgrounds.find(settings.file);
      // A file kind without a usable file is not a background: an administrator
      // who deleted the file leaves everybody with their own choice rather than
      // a locked, broken page.
      const kind = settings.kind === 'off' ? null : settings.kind === 'aurora' ? 'aurora' : file ? settings.kind : null;
      // What the browser keys its copy of the file on: the same bytes keep the
      // same hash however the file was replaced, and a different file is a
      // different hash - so a wallpaper is downloaded when it changes rather
      // than once per visit.
      const hash = file ? await services.backgrounds.hash(file.name) : null;
      res.json({
        configured: kind !== null,
        kind,
        file: file?.name ?? null,
        bytes: file?.bytes ?? 0,
        hash,
        note: settings.note || null,
        options: {
          crop: settings.crop,
          blur: settings.blur,
          dim: settings.dim,
          dynamic: settings.dynamic,
          auroraA: settings.auroraA,
          auroraB: settings.auroraB,
        },
        available: files.map((entry) => ({ name: entry.name, kind: entry.kind, bytes: entry.bytes })),
      });
    }),
  );

  router.get(
    '/file',
    handler(async (req, res) => {
      const wanted = typeof req.query.name === 'string' && req.query.name ? req.query.name : null;
      const settings = services.settings.effective().background;
      // Without a name this is the configured background, whatever that is;
      // with one it is a preview of a file in the folder, which is what the
      // settings dialog asks for while the choice is still being made.
      const file = wanted ? services.backgrounds.find(wanted) : services.backgrounds.find(settings.file);
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
      // With the hash in the query this URL names a particular version of the
      // file, so it can be kept for as long as the browser likes. Without one -
      // a hand written URL, a proxy that dropped it - the old short life and a
      // revalidation stay, because then nobody knows what this address means.
      const version = typeof req.query.v === 'string' ? req.query.v : '';
      const current = version ? await services.backgrounds.hash(file.name) : null;
      if (version && current && version === current) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
      }
      log.info(`serving background ${file.name}`);
      res.sendFile(absolute);
    }),
  );

  return router;
}