import fs from 'node:fs/promises';
import path from 'node:path';
import type { StorageDriver, StorageEntry, WriteOptions } from './types.js';
import { StorageError, baseName, normalisePath } from './types.js';

/** Stores notes on the local filesystem - used when OpenList is unavailable. */
export class LocalStorageDriver implements StorageDriver {
  readonly kind = 'local' as const;
  readonly label: string;
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
    this.label = `Local disk (${this.root})`;
  }

  private toFsPath(storagePath: string): string {
    const normalised = normalisePath(storagePath);
    const resolved = path.resolve(this.root, `.${normalised}`);
    const rel = path.relative(this.root, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new StorageError('Path escapes the storage root', 400, 'path_escape');
    }
    return resolved;
  }

  async list(dir: string): Promise<StorageEntry[]> {
    const fsPath = this.toFsPath(dir);
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(fsPath, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new StorageError(`Cannot list ${dir}: ${(err as Error).message}`);
    }
    const out: StorageEntry[] = [];
    for (const entry of entries) {
      const childStoragePath = normalisePath(`${normalisePath(dir)}/${entry.name}`);
      try {
        const stat = await fs.stat(path.join(fsPath, entry.name));
        out.push({
          name: entry.name,
          path: childStoragePath,
          isDir: stat.isDirectory(),
          size: stat.size,
          modified: stat.mtimeMs,
          created: stat.birthtimeMs || undefined,
        });
      } catch {
        out.push({ name: entry.name, path: childStoragePath, isDir: entry.isDirectory(), size: 0, modified: 0 });
      }
    }
    return out;
  }

  async readText(filePath: string): Promise<string> {
    try {
      return await fs.readFile(this.toFsPath(filePath), 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') throw new StorageError(`File not found: ${filePath}`, 404, 'not_found');
      throw new StorageError(`Cannot read ${filePath}: ${(err as Error).message}`);
    }
  }

  async write(filePath: string, content: string, options: WriteOptions = {}): Promise<void> {
    await this.writeBinary(filePath, new TextEncoder().encode(content), options.contentType, options);
  }

  async writeBinary(filePath: string, data: Uint8Array, _contentType?: string, options: WriteOptions = {}): Promise<void> {
    const fsPath = this.toFsPath(filePath);
    await fs.mkdir(path.dirname(fsPath), { recursive: true });
    if (options.overwrite === false) {
      try {
        await fs.access(fsPath);
        throw new StorageError(`File already exists: ${filePath}`, 409, 'exists');
      } catch (err) {
        if (err instanceof StorageError) throw err;
      }
    }
    const tmp = `${fsPath}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, fsPath);
    if (options.modified) {
      await fs.utimes(fsPath, options.modified, options.modified).catch(() => undefined);
    }
  }

  async mkdir(dirPath: string): Promise<void> {
    await fs.mkdir(this.toFsPath(dirPath), { recursive: true });
  }

  async ensureDir(dirPath: string): Promise<void> {
    await this.mkdir(dirPath);
  }

  async remove(dir: string, names: string[]): Promise<void> {
    for (const name of names) {
      await this.removePath(normalisePath(`${normalisePath(dir)}/${name}`));
    }
  }

  async removePath(target: string): Promise<void> {
    const fsPath = this.toFsPath(target);
    if (fsPath === this.root) throw new StorageError('Refusing to remove the storage root', 400);
    await fs.rm(fsPath, { recursive: true, force: true });
  }

  async rename(filePath: string, newName: string): Promise<void> {
    const fsPath = this.toFsPath(filePath);
    const target = path.join(path.dirname(fsPath), newName);
    if (path.relative(this.root, target).startsWith('..')) {
      throw new StorageError('Path escapes the storage root', 400, 'path_escape');
    }
    await fs.rename(fsPath, target);
  }

  async exists(target: string): Promise<boolean> {
    try {
      await fs.access(this.toFsPath(target));
      return true;
    } catch {
      return false;
    }
  }

  /** Absolute filesystem location of a storage path (diagnostics only). */
  describePath(storagePath: string): string {
    return this.toFsPath(storagePath);
  }

  static baseName = baseName;
}
