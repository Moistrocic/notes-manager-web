import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../logger.js';

const log = createLogger('sessions');

export type UserRole = 'admin' | 'user';
export type AuthProvider = 'local' | 'openlist';

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  provider: AuthProvider;
  /** OpenList token when the user signed in through OpenList. */
  openlistToken?: string;
  /** OpenList base path of the account (users can be jailed to a sub folder). */
  openlistBasePath?: string;
  openlistIsAdmin?: boolean;
  /** Anonymous visitor: nobody signed in. */
  guest?: boolean;
  /** Anonymous OpenList visitor - must never fall back to the service token. */
  openlistGuest?: boolean;
  permissions?: { write: boolean; rename: boolean; move: boolean; remove: boolean };
}

export interface SessionRecord extends SessionUser {
  sid: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  userAgent?: string;
  ip?: string;
}

export class SessionStore {
  private readonly file: string;
  private sessions = new Map<string, SessionRecord>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly dataDir: string, private readonly ttlMs: number) {
    this.file = path.join(dataDir, 'sessions.json');
    this.load();
  }

  private load(): void {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as { sessions?: SessionRecord[] };
      const now = Date.now();
      for (const s of raw.sessions ?? []) {
        if (s && typeof s.sid === 'string' && s.expiresAt > now) this.sessions.set(s.sid, s);
      }
      log.debug(`restored ${this.sessions.size} session(s)`);
    } catch {
      /* first run */
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 500);
    this.saveTimer.unref?.();
  }

  save(): void {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const tmp = `${this.file}.tmp`;
      const payload = { sessions: [...this.sessions.values()] };
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (err) {
      log.warn('failed to persist sessions:', (err as Error).message);
    }
  }

  create(user: SessionUser, meta: { userAgent?: string; ip?: string } = {}): SessionRecord {
    const now = Date.now();
    const record: SessionRecord = {
      ...user,
      sid: crypto.randomBytes(32).toString('hex'),
      createdAt: now,
      expiresAt: now + this.ttlMs,
      lastSeenAt: now,
      userAgent: meta.userAgent,
      ip: meta.ip,
    };
    this.sessions.set(record.sid, record);
    this.prune();
    this.scheduleSave();
    return record;
  }

  get(sid: string | undefined): SessionRecord | null {
    if (!sid) return null;
    const found = this.sessions.get(sid);
    if (!found) return null;
    if (found.expiresAt <= Date.now()) {
      this.sessions.delete(sid);
      this.scheduleSave();
      return null;
    }
    found.lastSeenAt = Date.now();
    // Sliding expiration, capped so long-lived sessions eventually re-auth.
    found.expiresAt = Math.min(found.expiresAt + 60_000, Date.now() + this.ttlMs);
    this.scheduleSave();
    return found;
  }

  /**
   * Signs out every visitor who never signed in.
   *
   * Turning guest access off has to mean something to the people already
   * browsing, or the switch would only apply to the next visitor.
   */
  destroyGuests(): number {
    let removed = 0;
    for (const [sid, record] of [...this.sessions]) {
      if (!record.guest) continue;
      this.sessions.delete(sid);
      removed += 1;
    }
    if (removed) this.scheduleSave();
    return removed;
  }

  update(sid: string, patch: Partial<SessionRecord>): void {
    const found = this.sessions.get(sid);
    if (!found) return;
    Object.assign(found, patch);
    this.scheduleSave();
  }

  destroy(sid: string | undefined): void {
    if (!sid) return;
    if (this.sessions.delete(sid)) this.scheduleSave();
  }

  destroyAll(): number {
    const n = this.sessions.size;
    this.sessions.clear();
    this.scheduleSave();
    return n;
  }

  count(): number {
    return this.sessions.size;
  }

  prune(): void {
    const now = Date.now();
    for (const [sid, s] of this.sessions) {
      if (s.expiresAt <= now) this.sessions.delete(sid);
    }
  }
}
