import './boot.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PROJECT_ROOT, envBool, envInt, envOptional, envStr, resolveFromRoot } from './env.js';
import { createLogger } from './logger.js';

const log = createLogger('config');

export type StorageDriver = 'auto' | 'openlist' | 'local';
export type SettingSource = 'env' | 'file' | 'default';

export interface OpenListSettings {
  url: string;
  token: string;
  root: string;
  perUser: boolean;
  timeoutMs: number;
}

export interface StorageSettings {
  driver: StorageDriver;
  openlist: OpenListSettings;
  local: { root: string };
}

/**
 * What everyone sees behind the app when the administrator has chosen.
 *
 * `off` is not a background: it hands the choice back to each user, which is
 * what an install that has never configured one does. `aurora` is the theme's
 * own background, which takes two colours rather than a file.
 */
export type BackgroundKind = 'off' | 'aurora' | 'image' | 'video' | 'scene';

/** Which part of the picture fills the screen, in fractions of the picture. */
export interface BackgroundCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BackgroundSettings {
  kind: BackgroundKind;
  /** File name inside the data directory's `backgrounds/` folder. */
  file: string;
  /** One line about where it came from, shown to whoever finds it later. */
  note: string;
  crop: BackgroundCrop;
  /** Blur radius in pixels, and how dark the scrim over it is. */
  blur: number;
  dim: number;
  /** Scenes only: render live, or composite a single frame. */
  dynamic: boolean;
  /** The theme's own background takes two colours; empty means the theme's. */
  auroraA: string;
  auroraB: string;
}

export interface GuestSettings {
  /**
   * Whether a visitor who has not signed in may browse read-only.
   *
   * On OpenList that is its own anonymous access; on a deployment whose notes
   * live on this server's disk it is a real decision, because there is no
   * folder permission anywhere to fall back on.
   */
  enabled: boolean;
}

export interface AppSettings {
  storage: StorageSettings;
  background: BackgroundSettings;
  guest: GuestSettings;
}

const BACKGROUND_KINDS: BackgroundKind[] = ['off', 'aurora', 'image', 'video', 'scene'];
/** The smallest selection the crop editor can produce, as a server side floor. */
const MIN_CROP = 0.05;

export const DEFAULT_BACKGROUND: BackgroundSettings = {
  kind: 'off',
  file: '',
  note: '',
  crop: { x: 0, y: 0, w: 1, h: 1 },
  blur: 0,
  // Dark enough that the glass panels read over a photograph, which is what
  // the user side defaults to as well.
  dim: 0.35,
  dynamic: false,
  auroraA: '',
  auroraB: '',
};

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

/** A colour the browser will accept, or nothing so the theme keeps its own. */
function colour(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : fallback;
}

function readCrop(value: unknown, fallback: BackgroundCrop): BackgroundCrop {
  if (!value || typeof value !== 'object') return fallback;
  const raw = value as Partial<BackgroundCrop>;
  const w = clampNumber(raw.w, MIN_CROP, 1, fallback.w);
  const h = clampNumber(raw.h, MIN_CROP, 1, fallback.h);
  return {
    x: clampNumber(raw.x, 0, 1 - w, fallback.x),
    y: clampNumber(raw.y, 0, 1 - h, fallback.y),
    w,
    h,
  };
}

export interface EffectiveSettings extends AppSettings {
  sources: {
    driver: SettingSource;
    openlistUrl: SettingSource;
    openlistToken: SettingSource;
    openlistRoot: SettingSource;
    openlistPerUser: SettingSource;
    localRoot: SettingSource;
  };
}

const DEFAULT_SETTINGS: AppSettings = {
  storage: {
    driver: 'auto',
    openlist: { url: '', token: '', root: '/notes', perUser: false, timeoutMs: 15000 },
    // Empty means "derive from DATA_DIR" (see SettingsStore.effective()).
    local: { root: '' },
  },
  background: DEFAULT_BACKGROUND,
  guest: { enabled: true },
};

export interface ServerConfig {
  host: string;
  port: number;
  basePath: string;
  publicUrl: string;
  dataDir: string;
  webDist: string;
  sessionTtlMs: number;
  adminUsername: string;
  adminPasswordEnv: string | undefined;
  authLocalEnabled: boolean;
  projectRoot: string;
  version: string;
}

function readVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function normaliseBasePath(raw: string): string {
  let p = raw.trim();
  if (!p || p === '/') return '';
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

export const serverConfig: ServerConfig = {
  host: envStr('HOST', '0.0.0.0'),
  port: envInt('PORT', 8080),
  basePath: normaliseBasePath(envStr('BASE_PATH', '')),
  publicUrl: envStr('PUBLIC_URL', '').replace(/\/+$/, ''),
  dataDir: resolveFromRoot(envStr('DATA_DIR', './data')),
  webDist: resolveFromRoot(envStr('WEB_DIST', './web/dist')),
  sessionTtlMs: envInt('SESSION_TTL_HOURS', 72) * 3600 * 1000,
  adminUsername: envStr('ADMIN_USERNAME', 'admin'),
  adminPasswordEnv: envOptional('ADMIN_PASSWORD'),
  authLocalEnabled: envBool('AUTH_LOCAL_ENABLED', true),
  projectRoot: PROJECT_ROOT,
  version: readVersion(),
};

function normaliseOpenListUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, '');
}

function normaliseStoragePath(raw: string, fallback: string): string {
  let p = (raw || fallback).trim();
  if (!p) p = fallback;
  if (!p.startsWith('/')) p = `/${p}`;
  p = p.replace(/\/+/g, '/');
  while (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

/** Persisted, UI-editable settings with environment variables taking priority. */
export class SettingsStore {
  private readonly file: string;
  private data: AppSettings;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'settings.json');
    this.data = this.read();
  }

  private read(): AppSettings {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<AppSettings>;
      return mergeSettings(DEFAULT_SETTINGS, raw);
    } catch {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  private persist(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  /** Raw values exactly as persisted (no env overlay) - used by the settings UI. */
  raw(): AppSettings {
    return structuredClone(this.data);
  }

  effective(): EffectiveSettings {
    const sources: EffectiveSettings['sources'] = {
      driver: 'default',
      openlistUrl: 'default',
      openlistToken: 'default',
      openlistRoot: 'default',
      openlistPerUser: 'default',
      localRoot: 'default',
    };

    let driver = this.data.storage.driver;
    const envDriver = envOptional('STORAGE_DRIVER')?.toLowerCase();
    if (envDriver && ['auto', 'openlist', 'local'].includes(envDriver)) {
      driver = envDriver as StorageDriver;
      sources.driver = 'env';
    } else if (driver !== DEFAULT_SETTINGS.storage.driver) {
      sources.driver = 'file';
    }

    let openlistUrl = this.data.storage.openlist.url;
    const envUrl = envOptional('OPENLIST_URL');
    if (envUrl) {
      openlistUrl = normaliseOpenListUrl(envUrl);
      sources.openlistUrl = 'env';
    } else if (openlistUrl) {
      sources.openlistUrl = 'file';
    }

    let openlistToken = this.data.storage.openlist.token;
    const envToken = envOptional('OPENLIST_TOKEN');
    if (envToken) {
      openlistToken = envToken;
      sources.openlistToken = 'env';
    } else if (openlistToken) {
      sources.openlistToken = 'file';
    }

    let openlistRoot = this.data.storage.openlist.root;
    const envRoot = envOptional('OPENLIST_ROOT');
    if (envRoot) {
      openlistRoot = normaliseStoragePath(envRoot, '/notes');
      sources.openlistRoot = 'env';
    } else if (openlistRoot !== DEFAULT_SETTINGS.storage.openlist.root) {
      sources.openlistRoot = 'file';
    }

    let perUser = this.data.storage.openlist.perUser;
    const envPerUser = envOptional('OPENLIST_PER_USER');
    if (envPerUser !== undefined) {
      perUser = envBool('OPENLIST_PER_USER', perUser);
      sources.openlistPerUser = 'env';
    } else if (perUser !== DEFAULT_SETTINGS.storage.openlist.perUser) {
      sources.openlistPerUser = 'file';
    }

    let localRoot = this.data.storage.local.root;
    const envLocalRoot = envOptional('NOTES_ROOT');
    if (envLocalRoot) {
      localRoot = envLocalRoot;
      sources.localRoot = 'env';
    } else if (localRoot) {
      sources.localRoot = 'file';
    }

    return {
      storage: {
        driver,
        openlist: {
          url: normaliseOpenListUrl(openlistUrl),
          token: openlistToken,
          root: normaliseStoragePath(openlistRoot, '/notes'),
          perUser,
          timeoutMs: this.data.storage.openlist.timeoutMs || 15000,
        },
        local: { root: localRoot ? resolveFromRoot(localRoot) : path.join(serverConfig.dataDir, 'notes') },
      },
      background: structuredClone(this.data.background),
      guest: structuredClone(this.data.guest),
      sources,
    };
  }

  update(patch: Partial<AppSettings>): EffectiveSettings {
    this.data = mergeSettings(this.data, patch);
    this.persist();
    log.info('settings updated');
    return this.effective();
  }
}

function mergeSettings(base: AppSettings, patch: Partial<AppSettings> | undefined): AppSettings {
  const out: AppSettings = structuredClone(base);
  if (!patch) return out;
  if (patch.storage) {
    const s = patch.storage;
    if (s.driver && ['auto', 'openlist', 'local'].includes(s.driver)) out.storage.driver = s.driver;
    if (s.openlist) {
      const o = s.openlist;
      if (typeof o.url === 'string') out.storage.openlist.url = o.url;
      if (typeof o.token === 'string') out.storage.openlist.token = o.token;
      if (typeof o.root === 'string') out.storage.openlist.root = o.root;
      if (typeof o.perUser === 'boolean') out.storage.openlist.perUser = o.perUser;
      if (typeof o.timeoutMs === 'number' && o.timeoutMs > 0) out.storage.openlist.timeoutMs = o.timeoutMs;
    }
    if (s.local && typeof s.local.root === 'string') out.storage.local.root = s.local.root;
  }
  if (patch.guest && typeof patch.guest.enabled === 'boolean') out.guest.enabled = patch.guest.enabled;
  if (patch.background) {
    const b = (patch.background ?? {}) as Partial<BackgroundSettings>;
    const current = out.background;
    if (b.kind && BACKGROUND_KINDS.includes(b.kind)) current.kind = b.kind;
    if (typeof b.file === 'string') current.file = b.file.trim();
    if (typeof b.note === 'string') current.note = b.note.trim().slice(0, 200);
    if (b.crop) current.crop = readCrop(b.crop, current.crop);
    if (b.blur !== undefined) current.blur = Math.round(clampNumber(b.blur, 0, 40, current.blur));
    if (b.dim !== undefined) current.dim = clampNumber(b.dim, 0, 0.85, current.dim);
    if (typeof b.dynamic === 'boolean') current.dynamic = b.dynamic;
    if (b.auroraA !== undefined) current.auroraA = colour(b.auroraA, '');
    if (b.auroraB !== undefined) current.auroraB = colour(b.auroraB, '');
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Generated secrets / persisted server state                                  */
/* -------------------------------------------------------------------------- */

export interface PersistedState {
  sessionSecret: string;
  adminUsername: string;
  adminPasswordHash: string | null;
  adminPasswordGenerated: boolean;
}

export class StateStore {
  private readonly file: string;
  private state: PersistedState;
  /** Plain-text password generated on first boot (only kept in memory + a file). */
  generatedPassword: string | null = null;

  constructor(private readonly dataDir: string) {
    this.file = path.join(dataDir, 'state.json');
    fs.mkdirSync(dataDir, { recursive: true });
    this.state = this.read();
  }

  private read(): PersistedState {
    let parsed: Partial<PersistedState> = {};
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<PersistedState>;
    } catch {
      parsed = {};
    }
    const state: PersistedState = {
      sessionSecret: parsed.sessionSecret || envStr('SESSION_SECRET', '') || crypto.randomBytes(48).toString('hex'),
      adminUsername: envStr('ADMIN_USERNAME', parsed.adminUsername || 'admin'),
      adminPasswordHash: parsed.adminPasswordHash ?? null,
      adminPasswordGenerated: parsed.adminPasswordGenerated ?? false,
    };
    return state;
  }

  save(): void {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  get(): PersistedState {
    return this.state;
  }

  setPasswordHash(hash: string | null, generated: boolean): void {
    this.state.adminPasswordHash = hash;
    this.state.adminPasswordGenerated = generated;
    this.save();
  }

  setAdminUsername(username: string): void {
    this.state.adminUsername = username;
    this.save();
  }

  /** Stores the bootstrap admin password so the operator can retrieve it. */
  writeGeneratedPasswordFile(password: string): string {
    const file = path.join(this.dataDir, 'initial-admin.txt');
    const body = [
      'notes-manager-web - generated administrator credentials',
      '=======================================================',
      `username: ${this.state.adminUsername}`,
      `password: ${password}`,
      '',
      'This file is only written when ADMIN_PASSWORD was not provided.',
      'Set ADMIN_PASSWORD in .env (and restart) to use a password of your choice,',
      'then delete this file.',
      '',
    ].join('\n');
    fs.writeFileSync(file, body, { encoding: 'utf8', mode: 0o600 });
    return file;
  }
}
