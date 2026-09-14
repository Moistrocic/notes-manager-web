import { OpenListClient, OpenListError } from '../integrations/openlist/client.js';
import type { StorageDriver, StorageEntry, WriteOptions } from './types.js';
import { StorageError, baseName, joinPath, normalisePath, parentPath } from './types.js';

const TEXT_FALLBACK_HINT = /not found|object not found/i;

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

  constructor(
    private readonly client: OpenListClient,
    openlistRoot: string,
    label?: string,
  ) {
    this.rootPath = normalisePath(openlistRoot, '/');
    this.root = this.rootPath;
    this.label = label ?? `OpenList (${client.baseUrl}${this.rootPath === '/' ? '' : this.rootPath})`;
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

  async readText(filePath: string): Promise<string> {
    const target = this.toRemote(filePath);
    try {
      return await this.client.readText(target);
    } catch (err) {
      if (err instanceof OpenListError && (err.status === 401 || err.status === 403)) {
        this.wrap(err, 'read', target);
      }
      // Direct links can be blocked (referer protection, signed URLs, ...).
      // The proxy endpoint always streams the bytes through OpenList itself.
      try {
        return await this.client.readTextViaProxy(target);
      } catch {
        this.wrap(err, 'read', target);
      }
    }
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

  async exists(target: string): Promise<boolean> {
    try {
      return await this.client.exists(this.toRemote(target));
    } catch (err) {
      this.wrap(err, 'inspect', this.toRemote(target));
    }
  }
}
