import express, { Router } from 'express';
import { BackgroundRemoveError, MAX_BACKGROUND_BYTES } from '../../backgrounds/store.js';
import { createLogger } from '../../logger.js';
import { handler, requireAdmin } from '../middleware.js';
import type { Services } from '../../services.js';

const log = createLogger('routes:background');

/**
 * The kind the layer is really showing, from the settings and from the files.
 *
 * A file kind without a usable file is not a background: an administrator who
 * deleted the file leaves everybody with their own choice rather than a locked,
 * broken page. GET / and DELETE / share this answer so the two cannot disagree
 * about what "configured" means.
 */
function configuredKind(services: Services): 'aurora' | 'image' | 'video' | 'scene' | 'custom' | null {
  const settings = services.settings.effective().background;
  if (settings.kind === 'off') return null;
  if (settings.kind === 'aurora') return 'aurora';
  const file = services.backgrounds.find(settings.file);
  return file && (settings.kind !== 'custom' || file.kind === 'image') ? settings.kind : null;
}

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
      const kind = configuredKind(services);
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
          customSway: settings.customSway,
          customSwayAmplitude: settings.customSwayAmplitude,
          customSwayFrequency: settings.customSwayFrequency,
          customShowParticles: settings.customShowParticles,
          customParticleRise: settings.customParticleRise,
          customParticleDrift: settings.customParticleDrift,
          customParticleDirection: settings.customParticleDirection,
          customParticleDensity: settings.customParticleDensity,
          customParticleColor: settings.customParticleColor,
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

  /**
   * Uploads a picture for the custom background.
   *
   * Raw bytes with the label in a header, the same shape as the note and font
   * uploads: no multipart parser, and the bytes stored are the bytes sent. The
   * client shrinks the picture first; the format is taken from the bytes, and
   * the settings keep naming the resulting file, so the existing GET / and
   * GET /file routes serve it like any hand-dropped background.
   *
   * Contract: POST /api/background, requireAdmin, Content-Type
   * application/octet-stream, X-Background-Filename (percent-encoded label),
   * body = PNG/JPEG/WebP/GIF bytes, max 20 MB. 201 { file, available };
   * 400 empty_body/invalid_background; 401 unauthenticated; 403 forbidden;
   * 413 request entity too large (from the raw body parser).
   */
  router.post(
    '/',
    requireAdmin,
    express.raw({ type: () => true, limit: MAX_BACKGROUND_BYTES + 1024 }),
    handler(async (req, res) => {
      const body = req.body as Buffer | undefined;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        res.status(400).json({ error: { message: '没有收到图片数据', code: 'empty_body' } });
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
      const fileName = decode(req.headers['x-background-filename']) || 'background';
      try {
        const file = services.backgrounds.save(fileName, body);
        res.status(201).json({ file, available: services.backgrounds.list() });
      } catch (err) {
        res.status(400).json({ error: { message: (err as Error).message, code: 'invalid_background' } });
      }
    }),
  );

  /**
   * Deletes a file from the background folder.
   *
   * Contract: DELETE /api/background?name=<percent-encoded file name>,
   * requireAdmin. 200 { removed, available, configured, kind, reset };
   * 400 invalid_background_name; 401 unauthenticated; 403 forbidden;
   * 404 background_not_found.
   *
   * When the deleted file was the configured background the setting is reset to
   * `off` in the same request and `reset: true` says so: a settings file that
   * names a file which is gone would leave the sign-in screen pointing at a 404,
   * and the caller should not have to guess that it happened.
   */
  router.delete(
    '/',
    requireAdmin,
    handler(async (req, res) => {
      const name = typeof req.query.name === 'string' ? req.query.name : '';
      try {
        const removed = services.backgrounds.remove(name);
        const settings = services.settings.effective().background;
        const reset = settings.file === removed.name;
        if (reset) {
          services.settings.update({ background: { ...settings, kind: 'off', file: '', note: '' } });
          log.info(`background ${removed.name} was in use - reset to off`);
        }
        const kind = configuredKind(services);
        res.json({
          removed: removed.name,
          available: services.backgrounds.list(),
          configured: kind !== null,
          kind,
          reset,
        });
      } catch (err) {
        if (!(err instanceof BackgroundRemoveError)) throw err;
        const status = err.code === 'background_not_found' ? 404 : 400;
        res.status(status).json({ error: { message: err.message, code: err.code } });
      }
    }),
  );

  return router;
}