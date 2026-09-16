import { Router } from 'express';
import type { Services } from '../../services.js';
import { createLogger } from '../../logger.js';
import { SESSION_COOKIE, cookieValue, handler, requireAuth, sessionCookieOptions } from '../middleware.js';

const log = createLogger('routes:auth');

export function authRoutes(services: Services): Router {
  const router = Router();

  router.get(
    '/providers',
    handler(async (_req, res) => {
      const probe = await services.storage.probeOpenList();
      // Asked whether or not OpenList is reachable: a deployment without one
      // offers a read-only local guest, and the sign-in screen needs to know.
      const guest = await services.auth.guestAvailable();
      res.json({
        local: services.auth.localEnabled,
        openlist: probe.reachable,
        openlistConfigured: probe.configured,
        openlistUrl: probe.url || null,
        openlistInitialized: probe.initialized,
        openlistError: probe.reachable ? null : probe.error ?? null,
        guest,
      });
    }),
  );

  router.post(
    '/login',
    handler(async (req, res) => {
      const body = (req.body ?? {}) as { username?: string; password?: string; otp?: string; provider?: string };
      const result = await services.auth.login({
        username: String(body.username ?? ''),
        password: String(body.password ?? ''),
        otp: body.otp ? String(body.otp) : undefined,
        provider: (body.provider as 'auto' | 'openlist' | 'local' | 'guest' | undefined) ?? 'auto',
      });
      const session = services.sessions.create(result.user, {
        userAgent: req.headers['user-agent'],
        ip: req.ip,
      });
      res.cookie(SESSION_COOKIE, session.sid, sessionCookieOptions(services, req));
      log.info(`${result.user.username} signed in via ${result.provider}`);
      const { openlistToken: _token, ...safeUser } = session;
      res.json({ user: safeUser, provider: result.provider });
    }),
  );

  router.post(
    '/logout',
    handler(async (req, res) => {
      const sid = cookieValue(req, SESSION_COOKIE);
      if (req.session) await services.auth.logoutOpenList(req.session);
      services.sessions.destroy(sid);
      res.clearCookie(SESSION_COOKIE, { path: services.config.basePath || '/' });
      res.json({ ok: true });
    }),
  );

  router.get(
    '/me',
    handler(async (req, res) => {
      if (!req.session) {
        res.json({ user: null });
        return;
      }
      const { openlistToken: _token, ...safeUser } = req.session;
      res.json({ user: safeUser });
    }),
  );

  router.post(
    '/password',
    requireAuth,
    handler(async (req, res) => {
      const body = (req.body ?? {}) as { currentPassword?: string; newPassword?: string };
      await services.auth.changePassword(String(body.currentPassword ?? ''), String(body.newPassword ?? ''));
      res.json({ ok: true });
    }),
  );

  return router;
}
