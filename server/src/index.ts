import './boot.js';
import http from 'node:http';
import { createApp } from './app.js';
import { serverConfig } from './config.js';
import { createLogger } from './logger.js';
import { services } from './services.js';

const log = createLogger('server');

async function main(): Promise<void> {
  const app = createApp(services());
  const server = http.createServer(app);

  server.listen(serverConfig.port, serverConfig.host, () => {
    const shown = serverConfig.host === '0.0.0.0' || serverConfig.host === '::' ? 'localhost' : serverConfig.host;
    const base = serverConfig.basePath || '';
    log.info(`notes-manager-web ${serverConfig.version} listening on ${serverConfig.host}:${serverConfig.port}`);
    log.info(`  local:  http://${shown}:${serverConfig.port}${base || '/'}`);
    if (serverConfig.publicUrl) log.info(`  public: ${serverConfig.publicUrl}${base}`);
  });

  const shutdown = (signal: string) => {
    log.info(`received ${signal}, shutting down`);
    server.close(() => {
      services().sessions.save();
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
