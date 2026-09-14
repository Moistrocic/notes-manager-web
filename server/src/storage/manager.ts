import { OpenListClient } from '../openlist/client.js';
import type { SessionUser } from '../auth/sessions.js';
import type { SettingsStore } from '../config.js';
import { createLogger } from '../logger.js';
import { LocalStorageDriver } from './local.js';
import { OpenListStorageDriver } from './openlist.js';
import type { StorageDriver, StorageKind } from './types.js';
import { StorageError, joinPath, normalisePath } from './types.js';

const log = createLogger('storage');

export interface ProbeResult {
  configured: boolean;
  url: string;
  reachable: boolean;
  initialized: boolean;
  siteTitle?: string;
  version?: string;
  error?: string;
  checkedAt: number;
}

export interface ResolvedStorage {
  driver: StorageDriver;
  kind: StorageKind;
  /** Human readable location of the notes inside the active backend. */
  displayRoot: string;
  /** True when `auto` mode fell back to local disk because OpenList is down. */
  degraded: boolean;
  detail: string;
}

export interface StorageStatus {
  driver: StorageKind;
  mode: 'auto' | 'openlist' | 'local';
  displayRoot: string;
  degraded: boolean;
  detail: string;
  openlist: ProbeResult;
  localRoot: string;
  perUser: boolean;
  /** True when the current account can authenticate against OpenList. */
  tokenAttached: boolean;
}

const PROBE_TTL_MS = 8000;

function sanitizeSegment(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned || 'user';
}

export class StorageManager {
  private probeCache: { key: string; at: number; result: ProbeResult } | null = null;

  constructor(private readonly settings: SettingsStore, private readonly dataDir: string) {}

  /** Checks whether the configured OpenList instance answers (cached for a few seconds). */
  async probeOpenList(force = false): Promise<ProbeResult> {
    const cfg = this.settings.effective().storage.openlist;
    const key = `${cfg.url}|${cfg.timeoutMs}`;
    const now = Date.now();
    if (!force && this.probeCache && this.probeCache.key === key && now - this.probeCache.at < PROBE_TTL_MS) {
      return this.probeCache.result;
    }

    let result: ProbeResult;
    if (!cfg.url) {
      result = { configured: false, url: '', reachable: false, initialized: false, error: 'No OpenList URL configured', checkedAt: now };
    } else {
      const client = new OpenListClient({ baseUrl: cfg.url, timeoutMs: Math.min(cfg.timeoutMs, 6000) });
      const ping = await client.ping();
      result = {
        configured: true,
        url: cfg.url,
        reachable: ping.ok,
        initialized: ping.initialized,
        siteTitle: ping.siteTitle,
        version: ping.version,
        error: ping.ok ? undefined : 'OpenList did not respond to the health check',
        checkedAt: now,
      };
    }
    this.probeCache = { key, at: now, result };
    log.debug('openlist probe:', JSON.stringify(result));
    return result;
  }

  invalidateProbe(): void {
    this.probeCache = null;
  }

  /** Resolves the storage backend for one request (OpenList token depends on the user). */
  async resolve(user: SessionUser | null | undefined): Promise<ResolvedStorage> {
    const effective = this.settings.effective();
    const { driver: mode, openlist, local } = effective.storage;

    const useLocal = async (detail: string, degraded: boolean): Promise<ResolvedStorage> => {
      // `local.root` is an absolute filesystem path - never pass it through the
      // POSIX-style `joinPath` helper (that would mangle Windows paths).
      const driver = new LocalStorageDriver(local.root);
      return {
        driver,
        kind: 'local',
        displayRoot: local.root,
        degraded,
        detail,
      };
    };

    if (mode === 'local') {
      return useLocal('Local storage selected', false);
    }

    const probe = await this.probeOpenList();
    if (!probe.reachable) {
      if (mode === 'openlist') {
        throw new StorageError(
          probe.configured
            ? `OpenList at ${probe.url} is not reachable. Start OpenList or switch the storage driver to "local".`
            : 'No OpenList URL configured. Set one in Settings or switch the storage driver to "local".',
          503,
          'openlist_unreachable',
        );
      }
      return useLocal('OpenList not reachable - using local disk', true);
    }

    const token = user?.provider === 'openlist' && user.openlistToken ? user.openlistToken : openlist.token || undefined;
    if (!token) {
      // Anonymous access still works when OpenList allows guests, so we do not
      // hard fail here - the first real request will surface a clear 403.
      log.debug('resolving OpenList storage without a token (guest access)');
    }

    const client = new OpenListClient({ baseUrl: openlist.url, token, timeoutMs: openlist.timeoutMs });
    let root = openlist.root;
    if (openlist.perUser && user?.username) {
      root = normalisePath(`${root}/${sanitizeSegment(user.username)}`);
    }
    const driver = new OpenListStorageDriver(client, root);
    return {
      driver,
      kind: 'openlist',
      displayRoot: root,
      degraded: false,
      detail: token
        ? `OpenList account: ${user?.provider === 'openlist' ? user.username : 'service token'}`
        : 'OpenList guest access (read-only unless the folder is public)',
    };
  }

  async status(user?: SessionUser | null): Promise<StorageStatus> {
    const effective = this.settings.effective();
    const probe = await this.probeOpenList();
    const tokenAttached =
      Boolean(effective.storage.openlist.token) ||
      (user?.provider === 'openlist' && Boolean(user.openlistToken));
    const mode = effective.storage.driver;
    let kind: StorageKind;
    let degraded = false;
    let detail: string;

    if (mode === 'local') {
      kind = 'local';
      detail = 'Local storage selected';
    } else if (probe.reachable) {
      kind = 'openlist';
      detail = probe.siteTitle ? `Connected to ${probe.siteTitle}` : 'Connected to OpenList';
      if (!probe.initialized) detail += ' (not initialised yet)';
    } else if (mode === 'openlist') {
      kind = 'openlist';
      detail = probe.error ?? 'OpenList unreachable';
    } else {
      kind = 'local';
      degraded = true;
      detail = 'OpenList unreachable - notes are stored on the local disk';
    }

    const root = kind === 'openlist' ? effective.storage.openlist.root : effective.storage.local.root;
    return {
      driver: kind,
      mode,
      displayRoot: root,
      degraded,
      detail,
      openlist: probe,
      localRoot: effective.storage.local.root,
      perUser: effective.storage.openlist.perUser,
      tokenAttached,
    };
  }

  /** Standalone connection test used by the settings screen. */
  async testConnection(input: { url: string; token?: string }): Promise<{ ok: boolean; message: string; details?: Record<string, unknown> }> {
    const url = input.url.trim();
    if (!url) return { ok: false, message: 'Enter the OpenList URL first' };
    const client = new OpenListClient({ baseUrl: url, token: input.token, timeoutMs: 8000 });
    const ping = await client.ping();
    if (!ping.ok) {
      return { ok: false, message: `Could not reach OpenList at ${url}. Check the address, the port and the firewall.` };
    }
    const details: Record<string, unknown> = {
      initialized: ping.initialized,
      siteTitle: ping.siteTitle,
      version: ping.version,
    };
    if (input.token) {
      const subject = new OpenListClient({ baseUrl: url, token: input.token, timeoutMs: 8000 });
      try {
        const me = await subject.me();
        details.user = { username: me.username, role: me.role, basePath: me.base_path, permission: me.permission };
      } catch {
        return { ok: false, message: 'OpenList is reachable but the API token was rejected.', details };
      }
    }
    return {
      ok: true,
      message: ping.initialized ? 'OpenList is reachable and initialised' : 'OpenList is reachable but has no administrator yet',
      details,
    };
  }

  /** Makes sure the notes root exists (best effort, never fatal). */
  async ensureRoot(storage: ResolvedStorage): Promise<void> {
    try {
      await storage.driver.ensureDir('/');
    } catch (err) {
      log.debug('ensureRoot skipped:', (err as Error).message);
    }
  }
}
