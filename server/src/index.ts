import './boot.js';
import http from 'node:http';
import { createApp } from './app.js';
import { serverConfig } from './config.js';
import { createLogger } from './logger.js';
import { envDiagnostics } from './boot.js';
import { services } from './services.js';

const log = createLogger('server');

async function main(): Promise<void> {
  const svc = services();
  const app = createApp(svc);
  const server = http.createServer(app);

  server.listen(serverConfig.port, serverConfig.host, () => {
    const shown = serverConfig.host === '0.0.0.0' || serverConfig.host === '::' ? 'localhost' : serverConfig.host;
    const base = serverConfig.basePath || '';
    const effective = svc.settings.effective();
    const openlist = effective.storage.openlist;

    log.info(`notes-manager-web ${serverConfig.version}`);
    for (const line of envDiagnostics) {
      if (line.level === 'warn') log.warn(`  ${line.message}`);
      else log.info(`  ${line.message}`);
    }
    log.info(`  listening   : http://${shown}:${serverConfig.port}${base || '/'}`);
    if (serverConfig.publicUrl) log.info(`  public url  : ${serverConfig.publicUrl}${base}`);
    log.info(`  data dir    : ${serverConfig.dataDir}`);
    log.info(
      `  storage     : ${effective.storage.driver}` +
        (openlist.url ? ` -> ${openlist.url}${openlist.root}` : ' (no OpenList configured)'),
    );
    log.info(`  notes root  : ${effective.storage.local.root}`);
  });

  const shutdown = (signal: string) => {
    log.info(`received ${signal}, shutting down`);
    server.close(() => {
      svc.sessions.save();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => log.error('unhandled rejection:', reason));
}

main().catch((err) => {
  log.error('failed to start:', err);
  process.exit(1);
});
