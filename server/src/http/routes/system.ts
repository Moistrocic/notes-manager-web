import { Router } from 'express';
import type { Services } from '../../services.js';
import { createLogger } from '../../logger.js';
import { handler, requireAdmin } from '../middleware.js';
import { DEFAULT_ENV_FILE, activeEnvFile, envFileOverride } from '../../boot.js';
import type { AppSettings } from '../../config.js';

const log = createLogger('routes:system');
const startedAt = Date.now();

const KIND_LABELS: Record<string, string> = { image: '图片', video: '视频', scene: '场景壁纸' };

/**
 * Checks a background choice against the files that are actually there.
 *
 * The settings store cannot do this - it has no idea what is on disk - and a
 * file kind pointing at a file nobody can load would lock every user to a
 * broken background, so it is refused at the door instead.
 */
function validateBackground(services: Services, body: Partial<AppSettings>): { message: string; code: string } | null {
  const wanted = body.background;
  if (!wanted || wanted.kind === undefined) return null;
  if (wanted.kind === 'off' || wanted.kind === 'aurora') return null;
  if (!KIND_LABELS[wanted.kind]) return { message: `未知的背景类型「${String(wanted.kind)}」`, code: 'background_kind' };
  const name = typeof wanted.file === 'string' ? wanted.file.trim() : '';
  const file = services.backgrounds.find(name);
  if (!file) {
    return {
      message: name
        ? `backgrounds/ 里没有「${name}」，请先把文件放进去（重新读取可以刷新列表）`
        : '请选择一个背景文件',
      code: 'background_missing',
    };
  }
  if (file.kind !== wanted.kind) {
    return {
      message: `「${file.name}」是${KIND_LABELS[file.kind]}，不能当作${KIND_LABELS[wanted.kind]}使用`,
      code: 'background_kind_mismatch',
    };
  }
  return null;
}

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
      const refused = validateBackground(services, body);
      if (refused) {
        res.status(400).json({ error: refused });
        return;
      }
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
