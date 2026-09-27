import { OpenListClient } from '../integrations/openlist/client.js';
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
  /**
   * True when this resolution is not the configured backend.
   *
   * Nothing sets it any more: `auto` mode refuses with a 503 rather than falling
   * back to a different tree, so a request either gets the configured backend or
   * gets an error. The field stays because it says what "degraded" means, and
   * because a future partial-availability mode would need it again.
   */
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
/** How long an account's base path is remembered before it is asked for again. */
const BASE_PATH_TTL_MS = 5 * 60 * 1000;

function sanitizeSegment(value: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim();
  return cleaned || 'user';
}

/**
 * Maps the absolute notes root configured in `.env` onto the path a single
 * OpenList account may ask for.
 *
 * OpenList prefixes every request with the account's own `base_path`
 * (`JoinBasePath` is simply `path.Join(basePath, reqPath)`), so an account
 * jailed to `/public` asking for `/public/Notes` would end up in
 * `/public/public/Notes`. The configured value is therefore treated as an
 * absolute OpenList path and the base path is stripped before the request.
 */
export function resolveRootForAccount(
  absoluteRoot: string,
  basePath: string | undefined | null,
): { path: string; accessible: boolean; reason?: string } {
  const root = normalisePath(absoluteRoot, '/');
  const base = normalisePath(basePath || '/', '/');
  if (base === '/') return { path: root, accessible: true };
  if (root === base) return { path: '/', accessible: true };
  if (root.startsWith(`${base}/`)) return { path: root.slice(base.length), accessible: true };
  return {
    path: root,
    accessible: false,
    reason: `${root} is outside ${base}, which is the folder this OpenList account is limited to`,
  };
}

export class StorageManager {
  private probeCache: { key: string; at: number; result: ProbeResult } | null = null;
  /**
   * What the account behind a token is limited to, per token.
   *
   * OpenList joins every request path onto the account's own base path
   * (`user.JoinPath` -> `JoinBasePath`), so an absolute `OPENLIST_ROOT` such as
   * `/public/Notes` has to be asked for as `/Notes` *for that account* -
   * otherwise OpenList looks for `/public/public/Notes`. A session that signed
   * in through OpenList carries its base path; a service token does not, so the
   * account is asked once (`/api/me`) and remembered here, keyed by the token
   * so a changed token is asked about again.
   */
  private basePathCache = new Map<string, { base: string; at: number }>();

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
        error: ping.ok ? undefined : ping.error ?? 'OpenList did not respond to the health check',
        checkedAt: now,
      };
    }
    this.probeCache = { key, at: now, result };
    log.debug('openlist probe:', JSON.stringify(result));
    return result;
  }

  invalidateProbe(): void {
    this.probeCache = null;
    // The token may be a different one now, and its account may be jailed to a
    // different place.
    this.basePathCache.clear();
  }

  /**
   * The base path the account behind `token` is limited to, asked for once.
   *
   * Not being able to find out is not a new failure: the answer is `/`, which is
   * what the app assumed before this existed, and the request then reports the
   * path it could not read. Old OpenList builds and revoked tokens both end up
   * here, so this never throws.
   */
  private async accountBasePath(client: OpenListClient, token: string): Promise<string> {
    const cached = this.basePathCache.get(token);
    if (cached && Date.now() - cached.at < BASE_PATH_TTL_MS) return cached.base;
    let base = '/';
    try {
      const me = await client.me();
      base = normalisePath(me?.base_path ?? '/', '/');
    } catch (err) {
      log.debug(`could not read the token account's base path, assuming "/": ${(err as Error).message}`);
    }
    this.basePathCache.set(token, { base, at: Date.now() });
    return base;
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
      if (mode === 'openlist' && !probe.configured) {
        throw new StorageError(
          'No OpenList URL configured. Set one in Settings or switch the storage driver to "local".',
          503,
          'openlist_unreachable',
        );
      }
      if (probe.configured) {
        // "auto" used to fall back to the local disk here, and that is a trap the
        // hard way: the local tree is *not* a copy of the OpenList one, so a note
        // written while OpenList is down - published to the blog, most visibly -
        // disappears from the panel and the blog the moment OpenList answers
        // again, because both of them then read OpenList. Refusing is the honest
        // answer, and it is the only one that cannot lose a note.
        throw new StorageError(
          `Cannot reach OpenList at ${probe.url}: the notes are not available. They are not on the local disk ` +
            'either - that is a different tree, and writing to it would leave notes the app stops looking for the ' +
            'moment OpenList is back. Start OpenList, fix the URL, or switch the storage driver to "local". ' +
            '（OpenList 连不上：为避免把笔记写进本地副本，本次请求已拒绝；请启动 OpenList、修正地址，或把存储改为「本地」）',
          503,
          'openlist_unreachable',
        );
      }
      // Nothing is configured at all, so the local disk *is* the storage rather
      // than a fallback to it.
      return useLocal('OpenList is not configured yet - using the local disk', false);
    }

    // Sessions that signed in *through* OpenList use their own token and nothing
    // else. Falling back to the service token here would silently hand a guest
    // (or a low privileged account) the rights of whoever owns that token.
    const token = user?.provider === 'openlist' ? user.openlistToken || undefined : openlist.token || undefined;
    if (!token) {
      log.debug('resolving OpenList storage without a token (guest access)');
    }

    const client = new OpenListClient({ baseUrl: openlist.url, token, timeoutMs: openlist.timeoutMs });

    let absoluteRoot = openlist.root;
    if (openlist.perUser && user?.username) {
      absoluteRoot = normalisePath(`${absoluteRoot}/${sanitizeSegment(user.username)}`);
    }

    // Whose account is this request sent as, and what is that account limited to?
    // A session that signed in through OpenList knows. A service token does not,
    // so its account is asked - and the public blog reads with exactly that
    // token, which is how an absolute root used to be sent to a jailed account
    // as-is and come back "object not found".
    const basePath =
      user?.provider === 'openlist'
        ? user.openlistBasePath
        : token
          ? await this.accountBasePath(client, token)
          : '/';

    const resolved = resolveRootForAccount(absoluteRoot, basePath);
    if (!resolved.accessible) {
      throw new StorageError(
        `No access to ${absoluteRoot}: ${resolved.reason}. ` +
          `Change OPENLIST_ROOT, or use an account whose base path contains it. ` +
          `(当前 OpenList 账号被限制在 ${user?.openlistBasePath || '/'}，无法访问 ${absoluteRoot})`,
        403,
        'openlist_forbidden',
      );
    }

    log.debug(`openlist root: configured ${absoluteRoot}, base ${user?.openlistBasePath || '/'}, requesting ${resolved.path}`);
    const driver = new OpenListStorageDriver(client, resolved.path);
    return {
      driver,
      kind: 'openlist',
      displayRoot: absoluteRoot,
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
      detail = probe.configured ? probe.error ?? `Cannot reach ${probe.url}` : 'OpenList is not configured yet';
    } else if (!probe.configured) {
      // Nothing to fall back *from*: the driver is simply not set up yet.
      kind = 'local';
      degraded = false;
      detail = 'OpenList is not configured yet - notes are stored on the local disk';
    } else {
      // Configured but down: every request that needs the notes is refused (see
      // resolve()), so this is not "the notes are on disk" - it is "the notes are
      // not available right now".
      kind = 'local';
      degraded = true;
      detail = `Cannot reach OpenList at ${probe.url} - notes are unavailable until it is back (requests are refused; the local disk is a different tree, not a copy)`;
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
      // The reason matters: ECONNREFUSED means "nothing is listening there",
      // ETIMEDOUT means "filtered / wrong host", ENOTFOUND means "bad name".
      return {
        ok: false,
        message: `Could not reach OpenList at ${url}${ping.error ? ` - ${ping.error}` : ''}`,
        details: { url, error: ping.error ?? null },
      };
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
