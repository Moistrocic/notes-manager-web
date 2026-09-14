import { OpenListClient, OpenListError } from '../integrations/openlist/client.js';
import type { SettingsStore, StateStore, ServerConfig } from '../config.js';
import { createLogger } from '../logger.js';
import type { StorageManager } from '../storage/manager.js';
import { hashPassword, randomPassword, verifyPassword } from './passwords.js';
import type { SessionUser } from './sessions.js';

const log = createLogger('auth');

export class AuthError extends Error {
  constructor(message: string, readonly status = 401, readonly code?: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface LoginInput {
  username: string;
  password: string;
  otp?: string;
  /** `auto` tries OpenList first, then the local administrator account. */
  provider?: 'auto' | 'openlist' | 'local' | 'guest';
}

export interface LoginResult {
  user: SessionUser;
  provider: 'openlist' | 'local';
}

const PERM_WRITE = 1 << 3;
const PERM_RENAME = 1 << 4;
const PERM_MOVE = 1 << 5;
const PERM_REMOVE = 1 << 7;

export class AuthService {
  constructor(
    private readonly config: ServerConfig,
    private readonly state: StateStore,
    private readonly settings: SettingsStore,
    private readonly storageManager: StorageManager,
  ) {}

  get adminUsername(): string {
    return this.config.adminUsername || 'admin';
  }

  get localEnabled(): boolean {
    return this.config.authLocalEnabled;
  }

  /** Creates the bootstrap administrator on first run. */
  bootstrap(): void {
    const stored = this.state.get();
    if (this.config.adminPasswordEnv) {
      if (!verifyPassword(this.config.adminPasswordEnv, stored.adminPasswordHash)) {
        this.state.setPasswordHash(hashPassword(this.config.adminPasswordEnv), false);
        log.info('administrator password synchronised from ADMIN_PASSWORD');
      }
      return;
    }
    if (!stored.adminPasswordHash) {
      const password = randomPassword(16);
      this.state.setPasswordHash(hashPassword(password), true);
      const file = this.state.writeGeneratedPasswordFile(password);
      log.warn('================================================================');
      log.warn(' No ADMIN_PASSWORD configured - a random administrator account was created');
      log.warn(`   username: ${this.adminUsername}`);
      log.warn(`   password: ${password}`);
      log.warn(`   saved to: ${file}`);
      log.warn('================================================================');
    }
  }

  async login(input: LoginInput): Promise<LoginResult> {
    const provider = input.provider ?? 'auto';
    if (provider === 'guest') return { user: await this.loginAsGuest(), provider: 'openlist' };
    const username = (input.username ?? '').trim();
    if (!username || !input.password) throw new AuthError('Username and password are required', 400, 'invalid_credentials');

    if (provider === 'local') return { user: await this.loginLocal(username, input.password), provider: 'local' };

    if (provider === 'openlist' || provider === 'auto') {
      const probe = await this.storageManager.probeOpenList();
      if (probe.reachable) {
        try {
          return { user: await this.loginOpenList(username, input.password, input.otp), provider: 'openlist' };
        } catch (err) {
          if (err instanceof AuthError && err.code === 'otp_required') throw err;
          if (provider === 'openlist') throw err;
          log.debug(`openlist login failed (${(err as Error).message}), falling back to local account`);
        }
      } else if (provider === 'openlist') {
        throw new AuthError(
          probe.configured
            ? `OpenList at ${probe.url} is not reachable`
            : 'No OpenList instance is configured',
          503,
          'openlist_unreachable',
        );
      }
    }

    return { user: await this.loginLocal(username, input.password), provider: 'local' };
  }

  private async loginOpenList(username: string, password: string, otp?: string): Promise<SessionUser> {
    const cfg = this.settings.effective().storage.openlist;
    if (!cfg.url) throw new AuthError('No OpenList instance is configured', 503, 'openlist_unreachable');
    const client = new OpenListClient({ baseUrl: cfg.url, timeoutMs: cfg.timeoutMs });

    let token: string;
    try {
      token = await client.login(username, password, otp);
    } catch (err) {
      if (err instanceof OpenListError) {
        if (err.code === 402) {
          throw new AuthError('OpenList requires your two-factor authentication code', 401, 'otp_required');
        }
        if (err.status === 429) throw new AuthError(err.message, 429, 'too_many_attempts');
        if (err.status === 0) throw new AuthError('OpenList is unreachable', 503, 'openlist_unreachable');
        throw new AuthError(err.message || 'Invalid username or password', 401, 'invalid_credentials');
      }
      throw err;
    }

    let profile;
    try {
      profile = await client.withToken(token).me();
    } catch {
      // Older OpenList/AList builds still expose /api/me; if it fails we keep going
      // with the data we already have.
      profile = undefined;
    }

    const isAdmin = profile?.role === 2;
    const permission = profile?.permission ?? 0;
    const user: SessionUser = {
      id: `openlist:${profile?.id ?? username}`,
      username: profile?.username ?? username,
      displayName: profile?.username ?? username,
      role: isAdmin ? 'admin' : 'user',
      provider: 'openlist',
      openlistToken: token,
      openlistBasePath: profile?.base_path ?? '',
      openlistIsAdmin: isAdmin,
      permissions: {
        write: isAdmin || (permission & PERM_WRITE) !== 0,
        rename: isAdmin || (permission & PERM_RENAME) !== 0,
        move: isAdmin || (permission & PERM_MOVE) !== 0,
        remove: isAdmin || (permission & PERM_REMOVE) !== 0,
      },
    };
    log.info(`openlist sign-in: ${user.username} (${user.role})`);
    return user;
  }

  /**
   * Signs in as the anonymous OpenList visitor.
   *
   * No token is stored on purpose: the session then talks to OpenList without an
   * Authorization header, which is exactly what "guest" means there.
   */
  async loginAsGuest(): Promise<SessionUser> {
    const cfg = this.settings.effective().storage.openlist;
    if (!cfg.url) throw new AuthError('No OpenList instance is configured', 503, 'openlist_unreachable');
    const client = new OpenListClient({ baseUrl: cfg.url, timeoutMs: cfg.timeoutMs });
    const guest = await client.guestAccess();
    if (!guest.available) {
      throw new AuthError(guest.error || 'Guest access is not available on this OpenList', 403, 'guest_disabled');
    }
    const permission = guest.user?.permission ?? 0;
    const user: SessionUser = {
      id: 'openlist:guest',
      username: 'guest',
      displayName: '游客',
      role: 'user',
      provider: 'openlist',
      openlistBasePath: guest.user?.base_path ?? '',
      openlistIsAdmin: false,
      openlistGuest: true,
      permissions: {
        write: (permission & PERM_WRITE) !== 0,
        rename: (permission & PERM_RENAME) !== 0,
        move: (permission & PERM_MOVE) !== 0,
        remove: (permission & PERM_REMOVE) !== 0,
      },
    };
    log.info('openlist sign-in: guest');
    return user;
  }

  async guestAvailable(): Promise<boolean> {
    const cfg = this.settings.effective().storage.openlist;
    if (!cfg.url) return false;
    const client = new OpenListClient({ baseUrl: cfg.url, timeoutMs: Math.min(cfg.timeoutMs, 6000) });
    const guest = await client.guestAccess();
    return guest.available;
  }

  private async loginLocal(username: string, password: string): Promise<SessionUser> {
    if (!this.localEnabled) {
      throw new AuthError('Local sign-in is disabled on this server', 403, 'local_disabled');
    }
    const stored = this.state.get();
    if (username !== this.adminUsername || !verifyPassword(password, stored.adminPasswordHash)) {
      throw new AuthError('Invalid username or password', 401, 'invalid_credentials');
    }
    return {
      id: `local:${this.adminUsername}`,
      username: this.adminUsername,
      displayName: this.adminUsername,
      role: 'admin',
      provider: 'local',
      permissions: { write: true, rename: true, move: true, remove: true },
    };
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const stored = this.state.get();
    if (!verifyPassword(currentPassword, stored.adminPasswordHash)) {
      throw new AuthError('The current password is incorrect', 400, 'invalid_credentials');
    }
    if (!newPassword || newPassword.length < 6) {
      throw new AuthError('The new password must be at least 6 characters long', 400, 'weak_password');
    }
    this.state.setPasswordHash(hashPassword(newPassword), false);
    log.info('administrator password changed');
  }

  /** Signs the given OpenList token out of OpenList itself (best effort). */
  async logoutOpenList(user: SessionUser): Promise<void> {
    if (user.provider !== 'openlist' || !user.openlistToken) return;
    const cfg = this.settings.effective().storage.openlist;
    if (!cfg.url) return;
    await new OpenListClient({ baseUrl: cfg.url, token: user.openlistToken, timeoutMs: 6000 }).logout();
  }
}
