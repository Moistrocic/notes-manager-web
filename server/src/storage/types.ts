export type StorageKind = 'openlist' | 'local';

export interface StorageEntry {
  /** File/directory name. */
  name: string;
  /** Absolute storage path using POSIX separators, e.g. `/notes/abc.md`. */
  path: string;
  isDir: boolean;
  size: number;
  /** Modification time in epoch milliseconds (0 when unknown). */
  modified: number;
  created?: number;
}

export interface WriteOptions {
  contentType?: string;
  modified?: Date;
  /** When false the write fails if the target already exists. */
  overwrite?: boolean;
}

export interface StorageDriver {
  readonly kind: StorageKind;
  readonly label: string;
  /** Root directory every path is resolved against. */
  readonly root: string;
  list(dir: string): Promise<StorageEntry[]>;
  readText(path: string): Promise<string>;
  write(path: string, content: string, options?: WriteOptions): Promise<void>;
  writeBinary(path: string, data: Uint8Array, contentType?: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  ensureDir(path: string): Promise<void>;
  remove(dir: string, names: string[]): Promise<void>;
  removePath(path: string): Promise<void>;
  rename(path: string, newName: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /**
   * Whether the backend reported write access the last time it was asked.
   * `null` means "not known yet". OpenList answers this per listing
   * (`write`), which is more accurate than the account's permission bits.
   */
  readonly writable?: boolean | null;
}

export class StorageError extends Error {
  constructor(message: string, readonly status = 500, readonly code?: string) {
    super(message);
    this.name = 'StorageError';
  }
}

/** Normalises a storage path: always starts with `/`, no trailing slash, no `..`. */
export function normalisePath(input: string, fallback = '/'): string {
  const raw = (input ?? '').trim() || fallback;
  const segments: string[] = [];
  for (const segment of raw.split(/[\\/]+/)) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.length ? `/${segments.join('/')}` : '/';
}

export function joinPath(...parts: string[]): string {
  return normalisePath(parts.filter(Boolean).join('/'));
}

export function parentPath(p: string): string {
  const normalised = normalisePath(p);
  const idx = normalised.lastIndexOf('/');
  return idx <= 0 ? '/' : normalised.slice(0, idx);
}

export function baseName(p: string): string {
  const normalised = normalisePath(p);
  const idx = normalised.lastIndexOf('/');
  return idx === -1 ? normalised : normalised.slice(idx + 1);
}
