import { OpenListClient, OpenListError } from '../integrations/openlist/client.js';
import type { StorageDriver, StorageEntry, WriteOptions } from './types.js';
import { StorageError, baseName, joinPath, normalisePath, parentPath } from './types.js';

const TEXT_FALLBACK_HINT = /not found|object not found/i;
/**
 * How long a background move is waited for, and how often it is checked.
 *
 * OpenList answers `/api/fs/move` before the move happens, so the only way to
 * know it finished is to watch for it. 20s is generous for a rename inside one
 * storage; a move that is genuinely still queueing is reported rather than
 * assumed to have worked.
 */
const MOVE_POLL_MS = 300;
const MOVE_TIMEOUT_MS = 20_000;

/** How a background move is waited for. */
export interface MoveWaitOptions {
  /** How often the result is checked, in milliseconds. */
  pollMs?: number;
  /** How long to keep checking before giving up, in milliseconds. */
  timeoutMs?: number;
}

/**
 * Stores notes inside an OpenList directory.
 *
 * Paths handled by this driver are relative to {@link root}: `/a.md` is stored
 * as `<openlistRoot>/a.md` inside OpenList.
 */
export class OpenListStorageDriver implements StorageDriver {
  readonly kind = 'openlist' as const;
  readonly label: string;
  readonly root: string;
  private readonly rootPath: string;
  // Annotated: a readonly field keeps the literal type of its initialiser,
  // which would make the constructor's override impossible.
  private readonly movePollMs: number = MOVE_POLL_MS;
  private readonly moveTimeoutMs: number = MOVE_TIMEOUT_MS;
  private lastWriteFlag: boolean | null = null;

  /** Reported by OpenList with every listing. */
  get writable(): boolean | null {
    return this.lastWriteFlag;
  }

  constructor(
    private readonly client: OpenListClient,
    openlistRoot: string,
    label?: string,
    moveWait: MoveWaitOptions = {},
  ) {
    this.rootPath = normalisePath(openlistRoot, '/');
    this.root = this.rootPath;
    this.label = label ?? `OpenList (${client.baseUrl}${this.rootPath === '/' ? '' : this.rootPath})`;
    // A slow storage can need longer than the default; a test can need shorter.
    if (moveWait.pollMs && moveWait.pollMs > 0) this.movePollMs = moveWait.pollMs;
    if (moveWait.timeoutMs && moveWait.timeoutMs > 0) this.moveTimeoutMs = moveWait.timeoutMs;
  }

  /** Absolute path inside OpenList for a driver-relative storage path. */
  toRemote(storagePath: string): string {
    return joinPath(this.rootPath, storagePath);
  }

  private wrap(err: unknown, action: string, target: string): never {
    if (err instanceof StorageError) throw err;
    if (err instanceof OpenListError) {
      const status = err.status === 0 ? 503 : err.status || 500;
      if (err.isAuthError && !this.client.hasToken) {
        // By far the most common cause: a local administrator account without an
        // OpenList API token trying to write into a protected OpenList folder.
        throw new StorageError(
          'No OpenList token is attached to this account, so OpenList refused the request. ' +
            'Add an OpenList API token in Settings, or sign in with your OpenList account. ' +
            '(当前账户没有 OpenList 令牌：请在“设置”中填写 API 令牌，或改用 OpenList 账户登录)',
          401,
          'openlist_auth',
        );
      }
      const message = err.status === 0
        ? `OpenList is unreachable while trying to ${action} ${target}`
        : `OpenList could not ${action} ${target}: ${err.message}`;
      throw new StorageError(message, status, err.isAuthError ? 'openlist_auth' : undefined);
    }
    throw new StorageError(`Failed to ${action} ${target}: ${(err as Error).message}`);
  }

  async list(dir: string): Promise<StorageEntry[]> {
    const target = this.toRemote(dir);
    try {
      const result = await this.client.list(target);
      this.lastWriteFlag = result.write;
      const base = normalisePath(dir);
      return result.content
        .filter((entry) => entry && typeof entry.name === 'string')
        .map<StorageEntry>((entry) => ({
          name: entry.name,
          path: joinPath(base, entry.name),
          isDir: Boolean(entry.is_dir),
          size: typeof entry.size === 'number' ? entry.size : 0,
          modified: entry.modified ? Date.parse(entry.modified) || 0 : 0,
          created: entry.created ? Date.parse(entry.created) || undefined : undefined,
        }));
    } catch (err) {
      if (err instanceof OpenListError && TEXT_FALLBACK_HINT.test(err.message)) return [];
      this.wrap(err, 'list', target);
    }
  }

  async readBinary(filePath: string): Promise<Uint8Array> {
    const target = this.toRemote(filePath);
    try {
      return await this.client.readBytes(target);
    } catch (err) {
      if (err instanceof OpenListError && (err.status === 401 || err.status === 403)) {
        this.wrap(err, 'read', target);
      }
      // Direct links can be blocked (referer protection, signed URLs, ...).
      // The proxy endpoint always streams the bytes through OpenList itself.
      try {
        return await this.client.readBytesViaProxy(target);
      } catch {
        this.wrap(err, 'read', target);
      }
    }
  }

  async readText(filePath: string): Promise<string> {
    // One code path for both: the bytes are what OpenList actually serves, and
    // decoding them here keeps the direct/proxy fallback in a single place.
    return new TextDecoder().decode(await this.readBinary(filePath));
  }

  async write(filePath: string, content: string, options: WriteOptions = {}): Promise<void> {
    await this.writeBinary(filePath, new TextEncoder().encode(content), options.contentType, options);
  }

  async writeBinary(filePath: string, data: Uint8Array, contentType?: string, options: WriteOptions = {}): Promise<void> {
    const target = this.toRemote(filePath);
    try {
      await this.client.put(target, data, {
        contentType,
        modified: options.modified,
        overwrite: options.overwrite,
      });
    } catch (err) {
      this.wrap(err, 'write', target);
    }
  }

  async mkdir(dirPath: string): Promise<void> {
    const target = this.toRemote(dirPath);
    try {
      await this.client.mkdir(target);
    } catch (err) {
      this.wrap(err, 'create directory', target);
    }
  }

  async ensureDir(dirPath: string): Promise<void> {
    const target = this.toRemote(dirPath);
    try {
      await this.client.ensureDir(target);
    } catch (err) {
      this.wrap(err, 'create directory', target);
    }
  }

  async remove(dir: string, names: string[]): Promise<void> {
    const target = this.toRemote(dir);
    try {
      await this.client.remove(target, names);
    } catch (err) {
      this.wrap(err, 'remove', target);
    }
  }

  async removePath(target: string): Promise<void> {
    const remote = this.toRemote(target);
    try {
      await this.client.remove(parentPath(remote), [baseName(remote)]);
    } catch (err) {
      this.wrap(err, 'remove', remote);
    }
  }

  async rename(filePath: string, newName: string): Promise<void> {
    const target = this.toRemote(filePath);
    try {
      await this.client.rename(target, newName);
    } catch (err) {
      this.wrap(err, 'rename', target);
    }
  }

  /**
   * Moves an entry into another directory, and waits for it to arrive.
   *
   * `/api/fs/move` only *schedules* the work: FsMove creates a task and answers
   * "Successfully created N move task(s)" before anything has moved
   * (openlist/server/handles/fsmanage.go: "Create all tasks immediately without
   * any synchronous validation"). `rename` and `put` are synchronous, this one
   * is not - so the next request would read a tree where the file is still in
   * the old folder, and the interface would show a move that has not happened.
   * The task is therefore waited for, and a timeout is reported as a failure
   * rather than as success.
   */
  async move(source: string, targetDir: string): Promise<void> {
    const remote = this.toRemote(source);
    const destination = this.toRemote(targetDir);
    try {
      // OpenList moves by name inside a source directory, so the source is
      // addressed as "parent + name" and the name is carried over unchanged.
      await this.client.move(parentPath(remote), destination, [baseName(remote)]);
    } catch (err) {
      this.wrap(err, 'move', remote);
    }
    await this.waitForMove(remote, joinPath(destination, baseName(remote)));
  }

  /**
   * Waits until the move is visible at both ends.
   *
   * Both, not either: a destination that exists while the source is still there
   * is a copy in progress (or an older file of the same name), and the note
   * would be listed twice. A move inside one directory can never satisfy that,
   * so it is not waited for at all.
   */
  private async waitForMove(source: string, destination: string): Promise<void> {
    if (source === destination) return;
    const deadline = Date.now() + this.moveTimeoutMs;
    for (;;) {
      const [atDestination, atSource] = await Promise.all([
        this.client.exists(destination).catch(() => false),
        this.client.exists(source).catch(() => false),
      ]);
      if (atDestination && !atSource) return;
      if (Date.now() >= deadline) {
        throw new StorageError(
          `OpenList 仍在后台搬运 ${source} → ${destination}，文件还没有到位，请稍后重试`,
          504,
          'openlist_move_pending',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, this.movePollMs));
    }
  }

  async exists(target: string): Promise<boolean> {
    try {
      return await this.client.exists(this.toRemote(target));
    } catch (err) {
      this.wrap(err, 'inspect', this.toRemote(target));
    }
  }
}
