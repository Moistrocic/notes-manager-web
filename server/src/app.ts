import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from './logger.js';
import { createContextMiddleware } from './http/middleware.js';
import { authRoutes } from './http/routes/auth.js';
import { notesRoutes } from './http/routes/notes.js';
import { systemRoutes } from './http/routes/system.js';
import { fontRoutes } from './http/routes/fonts.js';
import type { Services } from './services.js';

const log = createLogger('http');

const FALLBACK_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>notes-manager-web</title>
<style>
  body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#0b1020;color:#e8ecff;
  display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  .card{max-width:640px;padding:40px;border-radius:20px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12)}
  code{background:rgba(255,255,255,.1);padding:2px 6px;border-radius:6px}
  h1{margin-top:0;font-size:22px} p{line-height:1.6;color:#b9c3e6}
</style></head>
<body><div class="card"><h1>Front-end build not found</h1>
<p>The API is running, but <code>web/dist</code> does not exist yet.</p>
<p>Build the interface with <code>npm run build</code> (from the project root) and reload this page.</p>
</div></body></html>`;

export function createApp(services: Services): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '8mb' }));
  app.use(createContextMiddleware(services));

  const router = express.Router();
  router.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
    }
    next();
  });
  router.use('/api/auth', authRoutes(services));
  router.use('/api/notes', notesRoutes(services));
  router.use('/api/system', systemRoutes(services));
  // raw bodies (font uploads) must not be parsed as JSON
  router.use('/api/fonts', fontRoutes(services));
  router.use('/api', (_req, res) => {
    res.status(404).json({ error: { message: 'Unknown API endpoint', code: 'not_found' } });
  });

  app.use(services.config.basePath || '/', router);

  /* ------------------------------ static SPA ------------------------------ */
  const dist = services.config.webDist;
  const indexFile = path.join(dist, 'index.html');
  if (fs.existsSync(indexFile)) {
    const base = services.config.basePath || '';
    app.use(base || '/', express.static(dist, { index: false, maxAge: '1h', setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    } }));
    app.get(/\/.*/, (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.sendFile(indexFile);
    });
  } else {
    log.warn(`no front-end build found at ${dist} - API only`);
    app.get(/\/.*/, (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api/')) {
        next();
        return;
      }
      res.status(200).type('html').send(FALLBACK_PAGE);
    });
  }

  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: { message: `Not found: ${req.method} ${req.path}`, code: 'not_found' } });
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    log.error('unhandled error:', err);
    res.status(err.status ?? 500).json({ error: { message: err.message || 'Internal server error', code: 'internal' } });
  });

  return app;
}
