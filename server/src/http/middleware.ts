import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { SessionRecord } from '../auth/sessions.js';
import { AuthError } from '../auth/service.js';
import { OpenListError } from '../integrations/openlist/client.js';
import { createLogger } from '../logger.js';
import { StorageError } from '../storage/types.js';
import type { Services } from '../services.js';

const log = createLogger('http');

export const SESSION_COOKIE = 'nm_session';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      session?: SessionRecord | null;
      services: Services;
    }
  }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export function cookieValue(req: Request, name: string): string | undefined {
  return parseCookies(req.headers.cookie)[name];
}

export function sessionCookieOptions(services: Services, req: Request) {
  const secure =
    services.config.publicUrl.startsWith('https://') ||
    req.headers['x-forwarded-proto'] === 'https' ||
    Boolean((req.socket as { encrypted?: boolean } | undefined)?.encrypted);
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: services.config.basePath || '/',
    maxAge: services.config.sessionTtlMs,
  };
}

export function createContextMiddleware(services: Services): RequestHandler {
  const stateChanging = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  return (req: Request, res: Response, next: NextFunction) => {
    req.services = services;

    // Lightweight CSRF protection: browsers always send Origin on cross-site
    // state changing requests, so a mismatch is rejected.
    if (stateChanging.has(req.method)) {
      const origin = req.headers.origin;
      if (origin) {
        try {
          const originHost = new URL(origin).host;
          const targetHost = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers.host;
          if (targetHost && originHost !== targetHost) {
            res.status(403).json({ error: { message: 'Cross-site request blocked', code: 'csrf' } });
            return;
          }
        } catch {
          res.status(403).json({ error: { message: 'Invalid Origin header', code: 'csrf' } });
          return;
        }
      }
    }

    const sid = cookieValue(req, SESSION_COOKIE);
    req.session = services.sessions.get(sid) ?? null;
    next();
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session) {
    res.status(401).json({ error: { message: 'Sign in to continue', code: 'unauthenticated' } });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.session) {
    res.status(401).json({ error: { message: 'Sign in to continue', code: 'unauthenticated' } });
    return;
  }
  if (req.session.role !== 'admin') {
    res.status(403).json({ error: { message: 'Administrator rights are required', code: 'forbidden' } });
    return;
  }
  next();
}

export type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown;

/** Wraps an async handler and converts thrown errors into JSON responses. */
export function handler(fn: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch((err: unknown) => {
      if (res.headersSent) {
        next(err);
        return;
      }
      if (err instanceof AuthError) {
        res.status(err.status).json({ error: { message: err.message, code: err.code } });
        return;
      }
      if (err instanceof StorageError) {
        res.status(err.status).json({ error: { message: err.message, code: err.code } });
        return;
      }
      if (err instanceof OpenListError) {
        const status = err.status === 0 ? 503 : err.status >= 400 && err.status < 600 ? err.status : 502;
        res.status(status).json({ error: { message: err.message, code: 'openlist_error' } });
        return;
      }
      const status = (err as { status?: number }).status;
      if (typeof status === 'number' && status >= 400 && status < 600) {
        res.status(status).json({ error: { message: (err as Error).message } });
        return;
      }
      log.error('unhandled request error:', err);
      res.status(500).json({ error: { message: (err as Error).message || 'Internal server error', code: 'internal' } });
    });
  };
}
