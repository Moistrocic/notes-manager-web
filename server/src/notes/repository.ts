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
const MAX_FOLDER_DEPTH = 3;
const MAX_DIRS_PER_SCAN = 120;
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
          if (current.depth + 1 <= MAX_FOLDER_DEPTH - 1) queue.push({ dir: entry.path, depth: current.depth + 1 });
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

  async remove(user: SessionUser | null | undefined, id: string, permanent = false): Promise<{ trashed: boolean }> {
    const storage = await this.storageManager.resolve(user);
    const ns = this.namespace(storage, user);
    const driver = storage.driver;
    const note = await this.get(user, id);

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
    this.invalidate(`${this.namespace(storage, user)}:trash`);
    return removed;
  }

  async folders(user: SessionUser | null | undefined): Promise<{ path: string; name: string; count: number }[]> {
    const notes = await this.list(user);
    const counts = new Map<string, number>();
    for (const note of notes) {
      if (!note.folder) continue;
      counts.set(note.folder, (counts.get(note.folder) ?? 0) + 1);
    }
    const storage = await this.storageManager.resolve(user);
    const top = await storage.driver.list('/').catch(() => []);
    for (const entry of top) {
      if (!entry.isDir || entry.name === TRASH_DIR || entry.name.startsWith('.')) continue;
      if (!counts.has(entry.name)) counts.set(entry.name, 0);
    }
    return [...counts.entries()]
      .map(([path, count]) => ({ path, name: path, count }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  async createFolder(user: SessionUser | null | undefined, folder: string): Promise<string> {
    const storage = await this.storageManager.resolve(user);
    const clean = normaliseFolder(folder);
    if (!clean) throw new StorageError('Folder name must not be empty', 400, 'invalid_folder');
    await storage.driver.ensureDir(`/${clean}`);
    this.invalidate(this.namespace(storage, user));
    return clean;
  }

  async deleteFolder(user: SessionUser | null | undefined, folder: string): Promise<void> {
    const storage = await this.storageManager.resolve(user);
    const clean = normaliseFolder(folder);
    if (!clean) throw new StorageError('Folder name must not be empty', 400, 'invalid_folder');
    await storage.driver.removePath(`/${clean}`);
    this.invalidate(this.namespace(storage, user));
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
