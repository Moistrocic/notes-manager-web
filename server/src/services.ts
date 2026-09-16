import fs from 'node:fs';
import { AuthService } from './auth/service.js';
import { SessionStore } from './auth/sessions.js';
import { SettingsStore, StateStore, serverConfig, type ServerConfig } from './config.js';
import { BackgroundStore, adoptManifest } from './backgrounds/store.js';
import { FontStore } from './fonts/store.js';
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
  fonts: FontStore;
  /** The administrator's default background, read from the data directory. */
  backgrounds: BackgroundStore;
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
  const fonts = new FontStore(config.dataDir);

  const backgrounds = new BackgroundStore(config.dataDir);
  // A selection written by hand before this was a setting is taken over once.
  adoptManifest(settings, backgrounds);
  return { config, settings, state, sessions, storage, notes, auth, fonts, backgrounds };
}

let cached: Services | null = null;

export function services(): Services {
  if (!cached) cached = createServices();
  return cached;
}
