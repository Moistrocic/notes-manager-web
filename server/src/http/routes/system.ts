import { Router } from 'express';
import type { Services } from '../../services.js';
import { createLogger } from '../../logger.js';
import { handler, requireAdmin } from '../middleware.js';
import { DEFAULT_ENV_FILE, activeEnvFile, envFileOverride } from '../../boot.js';
import type { AppSettings } from '../../config.js';

const log = createLogger('routes:system');
const startedAt = Date.now();

export function systemRoutes(services: Services): Router {
  const router = Router();

  router.get(
    '/health',
    handler(async (req, res) => {
      const status = await services.storage.status(req.session).catch((err: Error) => ({
        driver: 'local' as const,
        mode: services.settings.effective().storage.driver,
        displayRoot: services.settings.effective().storage.local.root,
        degraded: true,
        detail: err.message,
        openlist: { configured: false, url: '', reachable: false, initialized: false, checkedAt: Date.now() },
        localRoot: services.settings.effective().storage.local.root,
        perUser: false,
        tokenAttached: false,
      }));
      res.json({
        ok: true,
        version: services.config.version,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        storage: { driver: status.driver, mode: status.mode, detail: status.detail, degraded: status.degraded },
      });
    }),
  );

  router.get(
    '/status',
    handler(async (req, res) => {
      const [storage, providers] = await Promise.all([
        services.storage.status(req.session),
        services.storage.probeOpenList().then((probe) => ({
          local: services.auth.localEnabled,
          openlist: probe.reachable,
          openlistInitialized: probe.initialized,
          openlistSiteTitle: probe.siteTitle ?? null,
        })),
      ]);
      const user = req.session ? (({ openlistToken: _t, ...rest }) => rest)(req.session) : null;
      res.json({
        version: services.config.version,
        basePath: services.config.basePath,
        publicUrl: services.config.publicUrl,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        storage,
        providers,
        user,
      });
    }),
  );

  router.get(
    '/settings',
    requireAdmin,
    handler(async (_req, res) => {
      const effective = services.settings.effective();
      const raw = services.settings.raw();
      res.json({
        settings: raw,
        effective,
        sources: effective.sources,
        paths: {
          projectRoot: services.config.projectRoot,
          dataDir: services.config.dataDir,
          localNotesRoot: effective.storage.local.root,
          envFile: activeEnvFile ?? envFileOverride ?? DEFAULT_ENV_FILE,
          envFileLoaded: activeEnvFile !== null,
        },
        env: {
          storageDriver: process.env.STORAGE_DRIVER ?? null,
          openlistUrl: process.env.OPENLIST_URL ?? null,
          openlistTokenSet: Boolean(process.env.OPENLIST_TOKEN),
          openlistRoot: process.env.OPENLIST_ROOT ?? null,
          notesRoot: process.env.NOTES_ROOT ?? null,
        },
      });
    }),
  );

  router.put(
    '/settings',
    requireAdmin,
    handler(async (req, res) => {
      const body = (req.body ?? {}) as Partial<AppSettings>;
      const effective = services.settings.update(body);
      services.storage.invalidateProbe();
      services.notes.clearCaches();
      log.info(`settings saved (driver=${effective.storage.driver}, openlist=${effective.storage.openlist.url || 'none'})`);
      res.json({ settings: services.settings.raw(), effective, status: await services.storage.status() });
    }),
  );

  router.post(
    '/openlist/test',
    requireAdmin,
    handler(async (req, res) => {
      const body = (req.body ?? {}) as { url?: string; token?: string };
      const result = await services.storage.testConnection({
        url: String(body.url ?? services.settings.effective().storage.openlist.url),
        token: body.token === undefined ? undefined : String(body.token),
      });
      res.status(result.ok ? 200 : 400).json(result);
    }),
  );

  router.post(
    '/cache/clear',
    requireAdmin,
    handler(async (_req, res) => {
      services.notes.clearCaches();
      services.storage.invalidateProbe();
      res.json({ ok: true });
    }),
  );

  return router;
}
