import fs from 'node:fs';
import { AuthService } from './auth/service.js';
import { SessionStore } from './auth/sessions.js';
import { SettingsStore, StateStore, serverConfig, type ServerConfig } from './config.js';
import { createLogger } from './logger.js';
import { NotesRepository } from './notes/repository.js';
import { StorageManager } from './storage/manager.js';

const log = createLogger('services');

export interface Services {
  config: ServerConfig;
  settings: SettingsStore;
  state: StateStore;
  sessions: SessionStore;
  storage: StorageManager;
  notes: NotesRepository;
  auth: AuthService;
}

export function createServices(): Services {
  const config = serverConfig;
  fs.mkdirSync(config.dataDir, { recursive: true });

  const settings = new SettingsStore(config.dataDir);
  const state = new StateStore(config.dataDir);
  const sessions = new SessionStore(config.dataDir, config.sessionTtlMs);
  const storage = new StorageManager(settings, config.dataDir);
  const notes = new NotesRepository(storage);
  const auth = new AuthService(config, state, settings, storage);
  auth.bootstrap();

  const effective = settings.effective();
  log.info(`storage driver: ${effective.storage.driver}`);
  log.info(`local notes root: ${effective.storage.local.root}`);
  log.info(`openlist url: ${effective.storage.openlist.url || '(not configured)'}`);

  return { config, settings, state, sessions, storage, notes, auth };
}

let cached: Services | null = null;

export function services(): Services {
  if (!cached) cached = createServices();
  return cached;
}
