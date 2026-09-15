import crypto from 'node:crypto';
import type { SessionUser } from '../auth/sessions.js';
import { createLogger } from '../logger.js';
import type { ResolvedStorage, StorageManager } from '../storage/manager.js';
import type { StorageDriver } from '../storage/types.js';
import { StorageError, baseName, joinPath, normalisePath, parentPath } from '../storage/types.js';
import { parseDocument, serialiseDocument } from './frontmatter.js';
import { countWords, hashId, slugify, toExcerpt } from './markdown.js';

const log = createLogger('notes');

export const TRASH_DIR = '_trash';
/**
 * Where trashed folders are recorded. Dot-prefixed, so every scan skips it and
 * it never shows up as a note or a folder.
 */
const FOLDER_TRASH_FILE = '.trash-folders.json';
/**
 * How deep the tree is walked. `MAX_FOLDER_DEPTH = 6` visits folders nested up
 * to five levels below the root - the previous value of 3 stopped after two
 * levels, so notes in `a/b/c/` were silently invisible.
 */
const MAX_FOLDER_DEPTH = 6;
/** Upper bound on directory requests per scan, so a huge tree stays responsive. */
const MAX_DIRS_PER_SCAN = 240;
const SCAN_TTL_MS = 1500;
const READ_CONCURRENCY = 6;
const NOTE_EXTENSIONS = ['.md', '.markdown'];

export interface NoteSummary {
  id: string;
  title: string;
  tags: string[];
  pinned: boolean;
  favorite: boolean;
  color: string | null;
  folder: string;
  path: string;
  created: string;
  updated: string;
  excerpt: string;
  wordCount: number;
  size: number;
  hasFrontMatter: boolean;
  deletedAt?: string | null;
  originFolder?: string | null;
}

export interface Note extends NoteSummary {
  content: string;
}

export interface NotePatch {
  title?: string;
  content?: string;
  tags?: string[];
  pinned?: boolean;
  favorite?: boolean;
  color?: string | null;
  folder?: string;
}

export interface CreateNoteInput extends NotePatch {
  content?: string;
}

interface CacheEntry {
  note: Note;
  size: number;
  modified: number;
}

interface ScanResult {
  at: number;
  files: { path: string; size: number; modified: number }[];
  idToPath: Map<string, string>;
}

function isNoteFile(name: string): boolean {
  const lower = name.toLowerCase();
  return NOTE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function stripExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}

function toIso(value: unknown, fallback: number): string {
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return new Date(fallback || Date.now()).toISOString();
}

function toTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.map((v) => String(v).trim()).filter(Boolean))].slice(0, 50);
  }
  if (typeof value === 'string') {
    return [...new Set(value.split(/[,，]\s*/).map((v) => v.trim()).filter(Boolean))].slice(0, 50);
  }
  return [];
}

function normaliseFolder(input: string | undefined | null): string {
  if (!input) return '';
  const cleaned = normalisePath(String(input)).replace(/^\/+/, '');
  if (!cleaned) return '';
  const segments = cleaned
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== '.' && segment !== '..' && !segment.startsWith('.') && segment !== TRASH_DIR);
  return segments.join('/');
}

async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T);
    }
  });
  await Promise.all(runners);
  return results;
}

export class NotesRepository {
  private caches = new Map<string, Map<string, CacheEntry>>();
  private scans = new Map<string, ScanResult>();

  constructor(private readonly storageManager: StorageManager) {}

  private namespace(storage: ResolvedStorage, user: SessionUser | null | undefined): string {
    const who = storage.kind === 'openlist' ? user?.username ?? 'anonymous' : 'local';
    return `${storage.kind}:${storage.displayRoot}:${who}`;
  }

  private cacheFor(ns: string): Map<string, CacheEntry> {
    let cache = this.caches.get(ns);
    if (!cache) {
      cache = new Map();
      this.caches.set(ns, cache);
    }
    return cache;
  }

  private invalidate(ns: string, path?: string): void {
    const scan = this.scans.get(ns);
    if (scan && !path) this.scans.delete(ns);
    if (scan && path) {
      scan.files = scan.files.filter((f) => f.path !== path);
      scan.at = 0;
    }
    const cache = this.caches.get(ns);
    if (cache) {
      if (path) cache.delete(path);
      else cache.clear();
    }
  }

  private async scan(storage: ResolvedStorage, ns: string, force = false): Promise<ScanResult> {
    const cached = this.scans.get(ns);
    if (!force && cached && Date.now() - cached.at < SCAN_TTL_MS) return cached;

    const driver = storage.driver;
    const files: ScanResult['files'] = [];
    const queue: { dir: string; depth: number }[] = [{ dir: '/', depth: 0 }];
    let visited = 0;

    while (queue.length && visited < MAX_DIRS_PER_SCAN) {
      const current = queue.shift() as { dir: string; depth: number };
      visited += 1;
      let entries;
      try {
        entries = await driver.list(current.dir);
      } catch (err) {
        if (current.dir === '/') throw err;
        log.warn(`skipping folder ${current.dir}: ${(err as Error).message}`);
        continue;
      }
      for (const entry of entries) {
        if (entry.isDir) {
          const name = entry.name;
          if (name === TRASH_DIR || name.startsWith('.')) continue;
          if (current.depth + 1 < MAX_FOLDER_DEPTH) queue.push({ dir: entry.path, depth: current.depth + 1 });
          continue;
        }
        if (!isNoteFile(entry.name)) continue;
        files.push({ path: entry.path, size: entry.size, modified: entry.modified });
      }
    }

    const result: ScanResult = { at: Date.now(), files, idToPath: new Map() };
    this.scans.set(ns, result);
    return result;
  }

  private async loadNote(
    storage: ResolvedStorage,
    ns: string,
    file: { path: string; size: number; modified: number },
  ): Promise<Note | null> {
    const cache = this.cacheFor(ns);
    const hit = cache.get(file.path);
    if (hit && hit.size === file.size && hit.modified === file.modified && file.modified !== 0) {
      return hit.note;
    }
    let raw: string;
    try {
      raw = await storage.driver.readText(file.path);
    } catch (err) {
      log.warn(`failed to read ${file.path}: ${(err as Error).message}`);
      cache.delete(file.path);
      return null;
    }
    const note = this.buildNote(file.path, raw, file);
    cache.set(file.path, { note, size: file.size, modified: file.modified });
    return note;
  }

  private buildNote(
    path: string,
    raw: string,
    file: { size: number; modified: number },
    overrides: Partial<NoteSummary> = {},
  ): Note {
    const doc = parseDocument(raw);
    const attrs = doc.attributes;
    const fallbackTime = file.modified || Date.now();
    const folder = parentPath(path) === '/' ? '' : parentPath(path).slice(1);
    const id = typeof attrs.id === 'string' && attrs.id.trim() ? attrs.id.trim() : hashId(path);
    const title =
      typeof attrs.title === 'string' && attrs.title.trim() ? attrs.title.trim() : stripExtension(baseName(path));
    const summary: NoteSummary = {
      id,
      title,
      tags: toTags(attrs.tags),
      pinned: attrs.pinned === true,
      favorite: attrs.favorite === true,
      color: typeof attrs.color === 'string' && attrs.color ? attrs.color : null,
      folder,
      path,
      created: toIso(attrs.created, fallbackTime),
      updated: toIso(attrs.updated, fallbackTime),
      excerpt: toExcerpt(doc.body),
      wordCount: countWords(doc.body),
      size: file.size || raw.length,
      hasFrontMatter: doc.hasFrontMatter,
      deletedAt: typeof attrs.deletedAt === 'string' ? attrs.deletedAt : null,
      originFolder: typeof attrs.originFolder === 'string' ? attrs.originFolder : null,
      ...overrides,
    };
    return { ...summary, content: doc.body };
  }

  /** Lists every note of the active storage backend (newest first, content included). */
  async list(user: SessionUser | null | undefined): Promise<Note[]> {
    const storage = await this.storageManager.resolve(user);
    const ns = this.namespace(storage, user);
    const scan = await this.scan(storage, ns);
    const notes = await mapLimit(scan.files, READ_CONCURRENCY, (file) => this.loadNote(storage, ns, file));
    const list = notes.filter((n): n is Note => Boolean(n));
    scan.idToPath = new Map(list.map((n) => [n.id, n.path]));
    return list
      .sort((a, b) => {
        const pin = Number(b.pinned) - Number(a.pinned);
        if (pin !== 0) return pin;
        return Date.parse(b.updated) - Date.parse(a.updated);
      });
  }

  async get(user: SessionUser | null | undefined, id: string): Promise<Note> {
    const storage = await this.storageManager.resolve(user);
    const ns = this.namespace(storage, user);
    const notes = await this.list(user);
    const summary = notes.find((n) => n.id === id);
    if (!summary) throw new StorageError(`Note ${id} was not found`, 404, 'note_not_found');
    const raw = await storage.driver.readText(summary.path);
    const note = this.buildNote(summary.path, raw, { size: summary.size, modified: Date.parse(summary.updated) });
    this.cacheFor(ns).set(summary.path, { note, size: summary.size, modified: Date.parse(summary.updated) });
    return note;
  }

  private async pickFileName(driver: StorageDriver, dir: string, base: string): Promise<string> {
    for (let i = 1; i <= 60; i += 1) {
      const candidate = i === 1 ? `${base}.md` : `${base}-${i}.md`;
      const target = joinPath(dir, candidate);
      // eslint-disable-next-line no-await-in-loop
      if (!(await driver.exists(target))) return candidate;
    }
    return `${base}-${crypto.randomBytes(3).toString('hex')}.md`;
  }

  async create(user: SessionUser | null | undefined, input: CreateNoteInput): Promise<Note> {
    const storage = await this.storageManager.resolve(user);
    const ns = this.namespace(storage, user);
    const driver = storage.driver;
    const now = new Date();
    const title = (input.title ?? '').trim() || '未命名笔记';
    const folder = normaliseFolder(input.folder);
    const dir = folder ? `/${folder}` : '/';
    if (folder) await driver.ensureDir(dir);

    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
    const fileName = await this.pickFileName(driver, dir, slugify(title));
    const path = joinPath(dir, fileName);
    const content = input.content ?? '';

    const attributes: Record<string, unknown> = {
      id,
      title,
      tags: input.tags ? toTags(input.tags) : [],
      created: now.toISOString(),
      updated: now.toISOString(),
      pinned: input.pinned === true,
      favorite: input.favorite === true,
    };
    if (input.color) attributes.color = input.color;

    let raw = serialiseDocument(attributes, content);
    try {
      await driver.write(path, raw, { modified: now, contentType: 'text/markdown; charset=utf-8' });
    } catch (err) {
      // Some storages report a stale existence check; retry once with a random suffix.
      if (err instanceof StorageError && err.status === 409) {
        const retryPath = joinPath(dir, `${slugify(title)}-${id.slice(0, 6)}.md`);
        raw = serialiseDocument(attributes, content);
        await driver.write(retryPath, raw, { modified: now, contentType: 'text/markdown; charset=utf-8' });
        this.invalidate(ns);
        return this.buildNote(retryPath, raw, { size: raw.length, modified: now.getTime() });
      }
      throw err;
    }
    this.invalidate(ns);
    log.info(`created note ${path}`);
    return this.buildNote(path, raw, { size: raw.length, modified: now.getTime() });
  }

  async update(user: SessionUser | null | undefined, id: string, patch: NotePatch): Promise<Note> {
    const storage = await this.storageManager.resolve(user);
    const ns = this.namespace(storage, user);
    const driver = storage.driver;
    const current = await this.get(user, id);
    const doc = parseDocument(await driver.readText(current.path));
    const attributes: Record<string, unknown> = { ...doc.attributes };

    if (patch.title !== undefined) attributes.title = patch.title.trim() || current.title;
    if (patch.tags !== undefined) attributes.tags = toTags(patch.tags);
    if (patch.pinned !== undefined) attributes.pinned = Boolean(patch.pinned);
    if (patch.favorite !== undefined) attributes.favorite = Boolean(patch.favorite);
    if (patch.color !== undefined) {
      if (patch.color) attributes.color = patch.color;
      else delete attributes.color;
    }
    attributes.id = current.id;
    if (!attributes.created) attributes.created = current.created;
    const now = new Date();
    attributes.updated = now.toISOString();

    const body = patch.content !== undefined ? patch.content : doc.body;
    const raw = serialiseDocument(attributes, body);

    let targetPath = current.path;
    const nextFolder = patch.folder !== undefined ? normaliseFolder(patch.folder) : current.folder;
    if (nextFolder !== current.folder) {
      const dir = nextFolder ? `/${nextFolder}` : '/';
      if (nextFolder) await driver.ensureDir(dir);
      targetPath = joinPath(dir, baseName(current.path));
      if (await driver.exists(targetPath)) {
        targetPath = joinPath(dir, await this.pickFileName(driver, dir, stripExtension(baseName(current.path))));
      }
      await driver.write(targetPath, raw, { modified: now, contentType: 'text/markdown; charset=utf-8' });
      await driver.removePath(current.path);
    } else {
      await driver.write(targetPath, raw, { modified: now, contentType: 'text/markdown; charset=utf-8' });
    }

    this.invalidate(ns);
    const note = this.buildNote(targetPath, raw, { size: raw.length, modified: now.getTime() });
    this.cacheFor(ns).set(targetPath, { note, size: raw.length, modified: now.getTime() });
    return note;
  }

  private trashName(path: string, id: string): string {
    const base = slugify(stripExtension(baseName(path)));
    return `${base}-${id.slice(0, 8)}.md`;
  }

  /** Finds a note in the active tree, falling back to the trash. */
  private async locate(user: SessionUser | null | undefined, id: string): Promise<Note> {
    try {
      return await this.get(user, id);
    } catch (err) {
      const trashed = await this.listTrash(user).catch(() => [] as Note[]);
      const found = trashed.find((n) => n.id === id);
      if (found) return found;
      throw err;
    }
  }

  /** What the active backend allows - used to disable editing in the UI. */
  async capabilities(user: SessionUser | null | undefined): Promise<{
    driver: 'openlist' | 'local';
    root: string;
    writable: boolean;
    permissions: SessionUser['permissions'];
  }> {
    const storage = await this.storageManager.resolve(user);
    const permissions = user?.permissions;
    const byPermission = permissions ? permissions.write && permissions.remove : true;
    return {
      driver: storage.kind,
      root: storage.displayRoot,
      // the backend's own answer wins; the permission bits are the fallback
      writable: storage.driver.writable ?? byPermission,
      permissions,
    };
  }

  async remove(user: SessionUser | null | undefined, id: string, permanent = false): Promise<{ trashed: boolean }> {
    const storage = await this.storageManager.resolve(user);
    const ns = this.namespace(storage, user);
    const driver = storage.driver;
    const note = await this.locate(user, id);

    if (permanent) {
      await driver.removePath(note.path);
      this.invalidate(ns);
      log.info(`permanently deleted note ${note.path}`);
      return { trashed: false };
    }


    const doc = parseDocument(await driver.readText(note.path));
    const attributes: Record<string, unknown> = {
      ...doc.attributes,
      id: note.id,
      title: note.title,
      deletedAt: new Date().toISOString(),
      originFolder: note.folder,
    };
    const raw = serialiseDocument(attributes, doc.body);
    await driver.ensureDir(`/${TRASH_DIR}`);
    let trashPath = joinPath(`/${TRASH_DIR}`, this.trashName(note.path, note.id));
    if (await driver.exists(trashPath)) {
      trashPath = joinPath(`/${TRASH_DIR}`, `${slugify(stripExtension(baseName(note.path)))}-${crypto.randomBytes(3).toString('hex')}.md`);
    }
    await driver.write(trashPath, raw, { modified: new Date(), contentType: 'text/markdown; charset=utf-8' });
    await driver.removePath(note.path);
    this.invalidate(ns);
    log.info(`moved note ${note.path} to trash`);
    return { trashed: true };
  }

  async listTrash(user: SessionUser | null | undefined): Promise<Note[]> {
    const storage = await this.storageManager.resolve(user);
    const ns = `${this.namespace(storage, user)}:trash`;
    const entries = await storage.driver.list(`/${TRASH_DIR}`).catch(() => []);
    const files = entries.filter((e) => !e.isDir && isNoteFile(e.name)).map((e) => ({ path: e.path, size: e.size, modified: e.modified }));
    const notes = await mapLimit(files, READ_CONCURRENCY, (file) => this.loadNote(storage, ns, file));
    return notes
      .filter((n): n is Note => Boolean(n))
      .sort((a, b) => Date.parse(b.deletedAt ?? b.updated) - Date.parse(a.deletedAt ?? a.updated));
  }

  async restore(user: SessionUser | null | undefined, id: string): Promise<Note> {
    const storage = await this.storageManager.resolve(user);
    const driver = storage.driver;
    const trashed = await this.listTrash(user);
    const found = trashed.find((n) => n.id === id);
    if (!found) throw new StorageError(`Note ${id} is not in the trash`, 404, 'note_not_found');
    const doc = parseDocument(await driver.readText(found.path));
    const attributes: Record<string, unknown> = { ...doc.attributes };
    delete attributes.deletedAt;
    delete attributes.originFolder;
    attributes.id = found.id;
    const now = new Date();
    attributes.updated = now.toISOString();

    const folder = normaliseFolder(found.originFolder ?? found.folder);
    const dir = folder ? `/${folder}` : '/';
    if (folder) await driver.ensureDir(dir);
    const name = await this.pickFileName(driver, dir, slugify(stripExtension(baseName(found.path))));
    const targetPath = joinPath(dir, name);
    const raw = serialiseDocument(attributes, doc.body);
    await driver.write(targetPath, raw, { modified: now, contentType: 'text/markdown; charset=utf-8' });
    await driver.removePath(found.path);
    this.invalidate(`${this.namespace(storage, user)}`);
    this.invalidate(`${this.namespace(storage, user)}:trash`);
    return this.buildNote(targetPath, raw, { size: raw.length, modified: now.getTime() });
  }

  async emptyTrash(user: SessionUser | null | undefined): Promise<number> {
    const storage = await this.storageManager.resolve(user);
    const driver = storage.driver;
    const entries = await driver.list(`/${TRASH_DIR}`).catch(() => []);
    let removed = 0;
    for (const entry of entries) {
      if (entry.isDir) continue;
      // eslint-disable-next-line no-await-in-loop
      await driver.removePath(entry.path).catch(() => undefined);
      removed += 1;
    }

    // Folders sit where they were, renamed, so emptying the trash has to find
    // them through the manifest rather than by listing a directory.
    const folders = await this.readFolderTrash(storage);
    for (const folder of folders) {
      // eslint-disable-next-line no-await-in-loop
      await driver.removePath(folder.path).catch(() => undefined);
      removed += 1;
    }
    if (folders.length > 0) await this.writeFolderTrash(storage, []);

    this.invalidate(`${this.namespace(storage, user)}:trash`);
    return removed;
  }

  /**
   * Every folder in the notes tree, including nested ones.
   *
   * `count` is the number of notes directly inside the folder (not the subtree),
   * so the UI can show a meaningful badge next to each level.
   */
  async folders(user: SessionUser | null | undefined): Promise<{ path: string; name: string; count: number; depth: number }[]> {
    const notes = await this.list(user);
    const counts = new Map<string, number>();
    for (const note of notes) {
      if (!note.folder) continue;
      counts.set(note.folder, (counts.get(note.folder) ?? 0) + 1);
    }

    // Walk the tree so that empty folders show up as well.
    const storage = await this.storageManager.resolve(user);
    const queue: { dir: string; depth: number }[] = [{ dir: '/', depth: 0 }];
    let visited = 0;
    while (queue.length && visited < MAX_DIRS_PER_SCAN) {
      const current = queue.shift() as { dir: string; depth: number };
      visited += 1;
      let entries;
      try {
        // eslint-disable-next-line no-await-in-loop
        entries = await storage.driver.list(current.dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDir) continue;
        if (entry.name === TRASH_DIR || entry.name.startsWith('.')) continue;
        const path = current.dir === '/' ? entry.name : `${current.dir.slice(1)}/${entry.name}`;
        if (!counts.has(path)) counts.set(path, 0);
        if (current.depth + 1 < MAX_FOLDER_DEPTH) queue.push({ dir: entry.path, depth: current.depth + 1 });
      }
    }

    return [...counts.entries()]
      .map(([path, count]) => ({
        path,
        name: path.split('/').pop() ?? path,
        count,
        depth: path.split('/').length - 1,
      }))
      .sort((a, b) => a.path.localeCompare(b.path, 'zh-Hans-CN'));
  }

  /**
   * Renames a folder in place.
   *
   * Only the directory entry changes. Every note's folder is derived from its
   * path on each scan, so the contents follow the rename without being
   * touched - which also means nested folders come along for free.
   */
  async renameFolder(user: SessionUser | null | undefined, folder: string, name: string): Promise<string> {
    const storage = await this.storageManager.resolve(user);
    const driver = storage.driver;
    const clean = normaliseFolder(folder);
    if (!clean) throw new StorageError('Folder name must not be empty', 400, 'invalid_folder');

    // Same rules as any other entry: one path segment, no leading dot, no slash.
    const next = normaliseFolder(name);
    if (!next || next.includes('/')) {
      throw new StorageError('Folder name must be a single name', 400, 'invalid_folder');
    }

    const path = `/${clean}`;
    if (!(await driver.exists(path))) {
      throw new StorageError('Folder not found', 404, 'folder_not_found');
    }
    const parent = parentPath(path);
    const target = joinPath(parent, next);
    if (target !== path && (await driver.exists(target))) {
      throw new StorageError(`已存在名为 ${next} 的文件夹`, 409, 'folder_exists');
    }

    if (target !== path) await driver.rename(path, next);
    this.invalidate(this.namespace(storage, user));
    log.info(`renamed folder ${clean} -> ${next}`);
    return `${parent === '/' ? '' : parent.slice(1)}/${next}`;
  }

  async createFolder(user: SessionUser | null | undefined, folder: string): Promise<string> {
    const storage = await this.storageManager.resolve(user);
    const clean = normaliseFolder(folder);
    if (!clean) throw new StorageError('Folder name must not be empty', 400, 'invalid_folder');
    await storage.driver.ensureDir(`/${clean}`);
    this.invalidate(this.namespace(storage, user));
    return clean;
  }

  /**
   * Moves a folder to the trash.
   *
   * The folder is renamed in place to a dotted name it can never collide with:
   * every scan already skips dot-prefixed entries, so it leaves the tree
   * without being moved anywhere, and no new driver primitive is needed -
   * rename() works within a parent, which is exactly the operation required.
   * The original path is written to a manifest at the notes root so it can be
   * put back, and so an empty trash can find it again.
   */
  async deleteFolder(user: SessionUser | null | undefined, folder: string): Promise<{ trashPath: string }> {
    const storage = await this.storageManager.resolve(user);
    const driver = storage.driver;
    const clean = normaliseFolder(folder);
    if (!clean) throw new StorageError('Folder name must not be empty', 400, 'invalid_folder');

    const path = `/${clean}`;
    const parent = parentPath(path);
    const name = baseName(path);
    const trashName = `.trashed-${slugify(name) || 'folder'}-${crypto.randomBytes(3).toString('hex')}`;

    await driver.rename(path, trashName);
    const trashPath = joinPath(parent, trashName);
    const manifest = await this.readFolderTrash(storage);
    manifest.push({ path: trashPath, originalPath: clean, name, deletedAt: new Date().toISOString() });
    await this.writeFolderTrash(storage, manifest);

    this.invalidate(this.namespace(storage, user));
    this.invalidate(`${this.namespace(storage, user)}:trash`);
    log.info(`moved folder ${clean} to trash as ${trashPath}`);
    return { trashPath };
  }

  /** Folders waiting in the trash, newest first. */
  async listFolderTrash(
    user: SessionUser | null | undefined,
  ): Promise<{ path: string; name: string; originalPath: string; deletedAt: string }[]> {
    const storage = await this.storageManager.resolve(user);
    const manifest = await this.readFolderTrash(storage);
    const alive: typeof manifest = [];
    for (const entry of manifest) {
      // A folder someone removed outside the app should not linger as a ghost.
      // eslint-disable-next-line no-await-in-loop
      if (await storage.driver.exists(entry.path).catch(() => false)) alive.push(entry);
    }
    if (alive.length !== manifest.length) await this.writeFolderTrash(storage, alive);
    return alive.sort((a, b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt));
  }

  /** Puts a trashed folder back, asking for a free name if the old one is taken. */
  async restoreFolder(user: SessionUser | null | undefined, trashPath: string): Promise<string> {
    const storage = await this.storageManager.resolve(user);
    const driver = storage.driver;
    const manifest = await this.readFolderTrash(storage);
    const entry = manifest.find((item) => item.path === trashPath);
    if (!entry) throw new StorageError('Folder is not in the trash', 404, 'folder_not_found');
    if (!(await driver.exists(entry.path))) {
      await this.writeFolderTrash(storage, manifest.filter((item) => item.path !== trashPath));
      throw new StorageError('Folder is no longer in the trash', 404, 'folder_not_found');
    }

    const parent = parentPath(entry.path);
    let name = slugify(entry.name) || 'folder';
    if (await driver.exists(joinPath(parent, name))) {
      name = `${name}-${crypto.randomBytes(2).toString('hex')}`;
    }
    await driver.rename(entry.path, name);
    await this.writeFolderTrash(storage, manifest.filter((item) => item.path !== trashPath));

    this.invalidate(this.namespace(storage, user));
    this.invalidate(`${this.namespace(storage, user)}:trash`);
    const restored = `${parent === '/' ? '' : parent.slice(1)}/${name}`;
    log.info(`restored folder to ${restored}`);
    return restored;
  }

  /** The folder manifest, which lives beside the notes and is dot-prefixed. */
  private async readFolderTrash(
    storage: ResolvedStorage,
  ): Promise<{ path: string; name: string; originalPath: string; deletedAt: string }[]> {
    try {
      const raw = await storage.driver.readText(`/${FOLDER_TRASH_FILE}`);
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (item): item is { path: string; name: string; originalPath: string; deletedAt: string } =>
          Boolean(item) && typeof (item as { path?: unknown }).path === 'string',
      );
    } catch {
      return [];
    }
  }

  private async writeFolderTrash(
    storage: ResolvedStorage,
    entries: { path: string; name: string; originalPath: string; deletedAt: string }[],
  ): Promise<void> {
    const path = `/${FOLDER_TRASH_FILE}`;
    if (entries.length === 0) {
      await storage.driver.removePath(path).catch(() => undefined);
      return;
    }
    await storage.driver.write(path, JSON.stringify(entries, null, 2), {
      modified: new Date(),
      contentType: 'application/json',
    });
  }

  /** Aggregated tag list with usage counts. */
  async tags(user: SessionUser | null | undefined): Promise<{ tag: string; count: number }[]> {
    const notes = await this.list(user);
    const counts = new Map<string, number>();
    for (const note of notes) {
      for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  /** Statistics for the dashboard header. */
  async stats(user: SessionUser | null | undefined): Promise<{ notes: number; tags: number; folders: number; words: number; updatedAt: string | null }> {
    const notes = await this.list(user);
    const tags = new Set<string>();
    let words = 0;
    let updated = 0;
    for (const note of notes) {
      note.tags.forEach((t) => tags.add(t));
      words += note.wordCount;
      updated = Math.max(updated, Date.parse(note.updated) || 0);
    }
    return {
      notes: notes.length,
      tags: tags.size,
      folders: new Set(notes.map((n) => n.folder).filter(Boolean)).size,
      words,
      updatedAt: updated ? new Date(updated).toISOString() : null,
    };
  }

  /** Removes cache entries of storage backends the user can no longer access. */
  clearCaches(): void {
    this.caches.clear();
    this.scans.clear();
  }
}
