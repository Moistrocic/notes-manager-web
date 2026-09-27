import crypto from 'node:crypto';
import type { SessionUser } from '../auth/sessions.js';
import { createLogger } from '../logger.js';
import type { ResolvedStorage, StorageManager } from '../storage/manager.js';
import type { StorageDriver } from '../storage/types.js';
import { StorageError, baseName, joinPath, normalisePath, parentPath } from '../storage/types.js';
import { parseDocument, serialiseDocument } from './frontmatter.js';
import { countWords, hashId, referencedPaths, slugify, toExcerpt, toSummaryMarkdown } from './markdown.js';

const log = createLogger('notes');

export const TRASH_DIR = '_trash';
/**
 * Where trashed folders are recorded. Dot-prefixed, so every scan skips it and
 * it never shows up as a note or a folder.
 */
const FOLDER_TRASH_FILE = '.trash-folders.json';
/**
 * Where trashed non-note files are recorded. A picture has no front matter to
 * hold `deletedAt`/`originFolder`, so - like folders - it is remembered here
 * instead. Dot-prefixed, so no scan ever shows it as an entry of its own.
 */
const FILE_TRASH_FILE = '.trash-files.json';
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
/**
 * Extensions whose bytes are text: a note, and the smallest thing that can
 * hold markdown. Everything else is stored and served as it arrived.
 */
const NOTE_EXTENSIONS = ['.md', '.markdown', '.txt'];
/** Extensions the panel shows as a picture rather than as a generic file. */
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif', '.ico'];

/**
 * What a file in the notes tree is.
 *
 * The tree used to be markdown only, but a note refers to pictures and those
 * live beside it in the same folders - so the scan lists every file and this
 * says which of them the editor has any business opening as text.
 */
export type EntryKind = 'note' | 'image' | 'file';

export interface NoteSummary {
  id: string;
  kind: EntryKind;
  /** Published to the blog - a mark that only a note can carry. */
  blog: boolean;
  /** When it was first published, so the blog never reorders itself. */
  blogAt: string | null;
  /** The card's own title, when the publish dialog set one. */
  blogTitle: string | null;
  /** The card's own summary, when the publish dialog set one. */
  blogSummary: string | null;
  /**
   * Whether the publish dialog has ever been used on this note.
   *
   * Derived from the front matter rather than stored in it: any one of the four
   * publish fields is enough, which is what keeps a withdrawn note in the
   * publish manager instead of making "unpublish" and "forget" the same thing.
   */
  hasPublishInfo: boolean;
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
  /** Publish to, or withdraw from, the blog. */
  blog?: boolean;
  /** The card's own title; empty or null removes the override. */
  blogTitle?: string | null;
  /** The card's own summary; empty or null removes the override. */
  blogSummary?: string | null;
}

/** One row of the publish manager: a note the publish dialog has been used on. */
export interface PublishEntry {
  id: string;
  /** Storage path, which is how the note is addressed. */
  path: string;
  /** File name, as it is on disk. */
  name: string;
  published: boolean;
  /** Null while the note is not on the blog. */
  publishedAt: string | null;
  /** What a card shows: the override when there is one, else the note's own. */
  title: string;
  summary: string;
  /** Whether each of those is an override rather than a fallback. */
  editedTitle: boolean;
  editedSummary: boolean;
  updatedAt: string;
}

/** One card on the blog: a published note, without its body. */
export interface BlogPostSummary {
  id: string;
  /** Storage path, which is also the address of its page. */
  path: string;
  title: string;
  /** The opening of the note, as markdown, for the card to render. */
  summary: string;
  publishedAt: string;
  updatedAt: string;
  wordCount: number;
  tags: string[];
}

export interface BlogPost extends BlogPostSummary {
  content: string;
}

export interface CreateNoteInput extends NotePatch {
  content?: string;
  /**
   * The file name to store the note under. Uploads set it, so the name the
   * user chose survives; without it the file is named after the title.
   */
  fileName?: string;
}

/** A non-note file waiting in the trash, as recorded in {@link FILE_TRASH_FILE}. */
interface TrashedFile {
  /** Where it sits now: under `/_trash`, keeping the name it arrived with. */
  trashPath: string;
  /** The full storage path it was deleted from. */
  originalPath: string;
  deletedAt: string;
}

interface CacheEntry {
  note: Note;
  size: number;
  modified: number;
}

interface ScannedFile {
  path: string;
  size: number;
  modified: number;
  kind: EntryKind;
}

interface ScanResult {
  at: number;
  files: ScannedFile[];
  idToPath: Map<string, string>;
}

/** The extension the file carries, `''` when it has none. */
export function fileExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(idx) : '';
}

/** Which of the three things a file name is. */
export function kindOf(name: string): EntryKind {
  const lower = name.toLowerCase();
  if (NOTE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'note';
  if (IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))) return 'image';
  return 'file';
}

function isNoteFile(name: string): boolean {
  return kindOf(name) === 'note';
}

/** The name without its extension - the title a `.md` upload is given. */
export function stripExtension(name: string): string {
  const idx = name.lastIndexOf('.');
  return idx > 0 ? name.slice(0, idx) : name;
}

/** The extension the file already uses, so a rename keeps `.markdown` as it was. */
function extensionOf(name: string): string {
  return fileExtension(name) || '.md';
}

/**
 * A file name that is safe on every platform, extension included.
 *
 * The name a browser sends is what the file is called afterwards, so it has to
 * keep its extension: that extension is how this server decides whether the
 * bytes are a note, a picture or something else. A name that is too long is
 * cut in the stem instead, never in the extension.
 */
export function sanitiseFileName(raw: string, fallback = 'file'): string {
  const cleaned = (raw ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  if (!cleaned) return fallback;
  if (cleaned.length <= 80) return cleaned;
  const extension = fileExtension(cleaned);
  return `${cleaned.slice(0, Math.max(1, 80 - extension.length))}${extension}`;
}

/** The folder a storage path sits in, as the UI writes it: `''` for the root. */
function folderOf(path: string): string {
  const parent = parentPath(path);
  return parent === '/' ? '' : parent.slice(1);
}

function toIso(value: unknown, fallback: number): string {
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return new Date(fallback || Date.now()).toISOString();
}

/** The front matter keys the publish dialog writes. */
const PUBLISH_KEYS = ['blog', 'blogAt', 'blogTitle', 'blogSummary'] as const;

/**
 * Whether a note's front matter has ever held publish information.
 *
 * Presence rather than truth: `blog: false`, left behind by "取消发布", is
 * exactly the trace that keeps the note in the publish manager. Reading it as
 * a boolean would make the row disappear the moment it was switched off.
 */
function hasPublishInfo(attrs: Record<string, unknown>): boolean {
  return PUBLISH_KEYS.some((key) => Object.prototype.hasOwnProperty.call(attrs, key));
}

/** A front matter override: a trimmed string, or null when there is none. */
function toOverride(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** An ISO timestamp from front matter, or null when there is no usable one. */
function toIsoOrNull(value: unknown): string | null {
  // A hand written `blogAt: 2020-01-01` comes back from YAML as a Date, while
  // the one this server writes is a string: both mean the same moment.
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return null;
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
        // Dot-prefixed files are this server's own bookkeeping (the trash
        // manifests), never something the user put there on purpose.
        if (entry.name.startsWith('.')) continue;
        // Every visible file is listed, not only the markdown: the pictures a
        // note refers to live in the same folders and belong in the tree.
        files.push({
          path: entry.path,
          size: entry.size,
          modified: entry.modified,
          kind: kindOf(entry.name),
        });
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
      kind: 'note',
      blog: attrs.blog === true,
      blogAt: toIsoOrNull(attrs.blogAt),
      blogTitle: toOverride(attrs.blogTitle),
      blogSummary: toOverride(attrs.blogSummary),
      hasPublishInfo: hasPublishInfo(attrs),
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

  /**
   * The summary of a file that must not be read as text.
   *
   * A picture is not a note: it has no front matter to parse and no body to
   * count, so everything the tree shows comes from the directory listing. The
   * title is the file name, extension and all - that, not a heading inside it,
   * is what the file is actually called.
   */
  private buildFileSummary(
    file: { path: string; size: number; modified: number; kind: EntryKind },
    overrides: Partial<NoteSummary> = {},
  ): Note {
    const iso = new Date(file.modified || Date.now()).toISOString();
    const summary: NoteSummary = {
      // Files carry no front matter to hold an id, so the path is the identity.
      id: hashId(file.path),
      kind: file.kind,
      // A file has no front matter to hold the mark, so it can never be on the
      // blog - which is also why nothing else here has to think about it.
      blog: false,
      blogAt: null,
      blogTitle: null,
      blogSummary: null,
      hasPublishInfo: false,
      title: baseName(file.path),
      tags: [],
      pinned: false,
      favorite: false,
      color: null,
      folder: folderOf(file.path),
      path: file.path,
      created: iso,
      updated: iso,
      excerpt: '',
      wordCount: 0,
      size: file.size,
      hasFrontMatter: false,
      deletedAt: null,
      originFolder: null,
      ...overrides,
    };
    return { ...summary, content: '' };
  }

  /** Lists every entry of the active storage backend (newest first, content included). */
  async list(user: SessionUser | null | undefined): Promise<Note[]> {
    const storage = await this.storageManager.resolve(user);
    const ns = this.namespace(storage, user);
    const scan = await this.scan(storage, ns);
    // Only notes are read. A picture is summarised straight from the listing,
    // because reading it as text would corrupt every byte that is not UTF-8.
    const notes = await mapLimit(scan.files, READ_CONCURRENCY, (file) =>
      file.kind === 'note' ? this.loadNote(storage, ns, file) : Promise.resolve(this.buildFileSummary(file)),
    );
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
    // A picture has no text to read: the listing already said everything there
    // is to say about it.
    if (summary.kind !== 'note') return summary;
    const raw = await storage.driver.readText(summary.path);
    const note = this.buildNote(summary.path, raw, { size: summary.size, modified: Date.parse(summary.updated) });
    this.cacheFor(ns).set(summary.path, { note, size: summary.size, modified: Date.parse(summary.updated) });
    return note;
  }

  /**
   * One file's exact bytes, by storage path.
   *
   * Pictures are served by path rather than by note id: the markup refers to a
   * path (`![x](../img/a.png)`) and the path is what stays true. Dot-prefixed
   * names are refused because they are this server's own bookkeeping (the trash
   * manifests); the driver refuses anything outside the storage root on top.
   */
  async readBinary(
    user: SessionUser | null | undefined,
    storagePath: string,
  ): Promise<{ path: string; data: Uint8Array }> {
    const storage = await this.storageManager.resolve(user);
    const normalised = normalisePath(String(storagePath ?? ''));
    if (normalised === '/' || normalised.split('/').some((segment) => segment.startsWith('.'))) {
      throw new StorageError('Invalid path', 400, 'invalid_path');
    }
    const data = await storage.driver.readBinary(normalised);
    return { path: normalised, data };
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

  /**
   * A free file name, keeping the extension the name came with.
   *
   * The name itself is the first candidate, so an upload keeps what the user
   * called it and only falls back to `-2`, `-3`, ... when something is there
   * already.
   *
   * `also` is a second directory the name has to be free in, and `self` is the
   * path of the file being renamed - it is not an obstacle to its own rename.
   * Both exist for the rename-and-move case: `rename` would overwrite a sibling
   * and `move` refuses a destination that is taken, so the name has to be free
   * on both sides of the operation.
   */
  private async pickFreeFileName(
    driver: StorageDriver,
    dir: string,
    fileName: string,
    options: { also?: string; self?: string } = {},
  ): Promise<string> {
    const extension = fileExtension(fileName);
    const stem = extension ? fileName.slice(0, -extension.length) : fileName;
    const dirs = this.nameDirs(dir, options.also);
    for (let i = 1; i <= 60; i += 1) {
      const candidate = i === 1 ? `${stem}${extension}` : `${stem}-${i}${extension}`;
      // eslint-disable-next-line no-await-in-loop
      if (await this.nameIsFree(driver, dirs, candidate, options.self)) return candidate;
    }
    return `${stem}-${crypto.randomBytes(3).toString('hex')}${extension}`;
  }

  /**
   * A random name no listed directory uses yet.
   *
   * Used where a clash is possible but `-2`, `-3`, ... would be misleading: two
   * files of the same name are not the same file twice, they are two different
   * files that happen to share a name.
   */
  private async randomFreeName(
    driver: StorageDriver,
    dir: string,
    fileName: string,
    options: { also?: string; self?: string } = {},
  ): Promise<string> {
    const extension = fileExtension(fileName);
    const stem = stripExtension(fileName) || 'file';
    const dirs = this.nameDirs(dir, options.also);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = `${stem}-${crypto.randomBytes(3).toString('hex')}${extension}`;
      // eslint-disable-next-line no-await-in-loop
      if (await this.nameIsFree(driver, dirs, candidate, options.self)) return candidate;
    }
    return `${stem}-${Date.now().toString(36)}${extension}`;
  }

  private nameDirs(dir: string, also?: string): string[] {
    return also && also !== dir ? [dir, also] : [dir];
  }

  /** Whether `candidate` is unused in every one of `dirs` (ignoring `self`). */
  private async nameIsFree(driver: StorageDriver, dirs: string[], candidate: string, self?: string): Promise<boolean> {
    for (const dir of dirs) {
      const target = joinPath(dir, candidate);
      if (target === self) continue;
      // eslint-disable-next-line no-await-in-loop
      if (await driver.exists(target)) return false;
    }
    return true;
  }

  /**
   * Stores a file exactly as it arrived.
   *
   * No front matter is written: these bytes are not markdown, and a YAML block
   * prepended to a picture is a corrupted picture. The name is the one the
   * upload carried, kept free with `-2`, `-3`, ... where that is taken.
   */
  async createFile(
    user: SessionUser | null | undefined,
    input: { name: string; folder?: string; data: Uint8Array; contentType?: string },
  ): Promise<Note> {
    const storage = await this.storageManager.resolve(user);
    const ns = this.namespace(storage, user);
    const driver = storage.driver;
    const folder = normaliseFolder(input.folder);
    const dir = folder ? `/${folder}` : '/';
    if (folder) await driver.ensureDir(dir);

    const fileName = await this.pickFreeFileName(driver, dir, sanitiseFileName(input.name, 'file'));
    const path = joinPath(dir, fileName);
    const now = new Date();
    const data = input.data ?? new Uint8Array();
    // overwrite: false closes the race between picking a free name and writing.
    await driver.writeBinary(path, data, input.contentType, { modified: now, overwrite: false });
    this.invalidate(ns);
    log.info(`created file ${path}`);
    return this.buildFileSummary({ path, size: data.byteLength, modified: now.getTime(), kind: kindOf(fileName) });
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
    // An upload keeps the name it arrived under - that is the whole point of
    // uploading a file into a folder the notes refer to. Anything created here
    // is named after its title, the way a new note always was.
    const fileName = input.fileName
      ? await this.pickFreeFileName(driver, dir, sanitiseFileName(input.fileName, 'note.md'))
      : await this.pickFileName(driver, dir, slugify(title));
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
    // A file has no front matter to patch: a title renames it, a folder moves
    // it, and tags, pins and colours have nowhere to be stored on a picture.
    if (current.kind !== 'note') return this.updateFile(storage, ns, current, patch);
    const doc = parseDocument(await driver.readText(current.path));
    const attributes: Record<string, unknown> = { ...doc.attributes };
    const now = new Date();

    if (patch.title !== undefined) attributes.title = patch.title.trim() || current.title;
    if (patch.tags !== undefined) attributes.tags = toTags(patch.tags);
    if (patch.pinned !== undefined) attributes.pinned = Boolean(patch.pinned);
    if (patch.favorite !== undefined) attributes.favorite = Boolean(patch.favorite);
    if (patch.color !== undefined) {
      if (patch.color) attributes.color = patch.color;
      else delete attributes.color;
    }
    if (patch.blog !== undefined) {
      if (patch.blog) {
        attributes.blog = true;
        // Stamped the first time only, and kept afterwards: marking a note as
        // published again - or just saving it - must not move it back to the
        // top of the blog.
        if (!current.blog || !current.blogAt) attributes.blogAt = now.toISOString();
      } else {
        // Not published, but said out loud. `blog: false` is what keeps the
        // note in the publish manager: deleting the field would make
        // "取消发布" and "删除发布信息" the same action, and a row would vanish
        // because somebody only wanted to take a post off the blog. The date
        // goes, though - a stale one would republish the note, dated, the
        // moment the switch was flipped back.
        attributes.blog = false;
        delete attributes.blogAt;
      }
    }
    if (patch.blogTitle !== undefined) {
      if (patch.blogTitle) attributes.blogTitle = patch.blogTitle.trim();
      else delete attributes.blogTitle;
    }
    if (patch.blogSummary !== undefined) {
      if (patch.blogSummary) attributes.blogSummary = patch.blogSummary.trim();
      else delete attributes.blogSummary;
    }
    attributes.id = current.id;
    if (!attributes.created) attributes.created = current.created;
    attributes.updated = now.toISOString();

    const body = patch.content !== undefined ? patch.content : doc.body;
    const raw = serialiseDocument(attributes, body);

    // A changed title renames the file itself, exactly like a folder change
    // moves it. Both are filesystem operations rather than "write a copy and
    // delete the original": on OpenList a write is an upload, so the note would
    // come back as a *new* file - new identity, no driver-side history - and the
    // old one would still be there whenever the delete did not take, which is
    // exactly the "the file in OpenList still has the old name" report.
    const nextFolder = patch.folder !== undefined ? normaliseFolder(patch.folder) : current.folder;
    const currentDir = parentPath(current.path);
    const currentName = baseName(current.path);
    const extension = extensionOf(currentName);
    const nextTitle = patch.title !== undefined ? patch.title.trim() : '';
    const wantedName =
      nextTitle && nextTitle !== current.title ? `${slugify(nextTitle)}${extension}` : currentName;
    const nameChanged = wantedName !== currentName;
    const moved = nextFolder !== current.folder;
    const dir = nextFolder ? `/${nextFolder}` : '/';
    // The folder the front matter names and the folder the file is actually in
    // can disagree - a note dropped into the tree from elsewhere keeps nothing
    // but its path - and a move into the directory a file already sits in is an
    // error to OpenList ("file [x] exists"), not a no-op. So the move is only
    // performed when the directories really differ.
    const relocating = moved && dir !== currentDir;

    let targetPath = current.path;
    if (!nameChanged && !moved) {
      await driver.write(targetPath, raw, { modified: now, contentType: 'text/markdown; charset=utf-8' });
    } else {
      // A name free on both sides of the operation: `rename` would overwrite a
      // sibling and `move` refuses a destination that is already taken, so a
      // note that is already there is never replaced. `self` keeps the note
      // from blocking its own rename.
      const chosen = await this.pickFreeFileName(driver, dir, wantedName, {
        also: relocating ? currentDir : undefined,
        self: current.path,
      });
      if (relocating && nextFolder) await driver.ensureDir(dir);
      // Rename first, then move: `rename` only reaches a sibling, so it has to
      // happen in the folder the file is in now, and `move` then carries the
      // new name across. The content lands on the final path, where the note
      // now is.
      if (chosen !== currentName) await driver.rename(current.path, chosen);
      if (relocating) await driver.move(joinPath(currentDir, chosen), dir);
      targetPath = joinPath(dir, chosen);
      await driver.write(targetPath, raw, { modified: now, contentType: 'text/markdown; charset=utf-8' });
    }

    this.invalidate(ns);
    const note = this.buildNote(targetPath, raw, { size: raw.length, modified: now.getTime() });
    this.cacheFor(ns).set(targetPath, { note, size: raw.length, modified: now.getTime() });
    return note;
  }

  /**
   * Forgets a note's publish information, leaving the note itself alone.
   *
   * This is the one action that takes a row off the publish list: withdrawing a
   * post keeps `blog: false` behind as a trace, deleting the note takes the
   * front matter with the file, and neither is what "删除发布信息" means.
   */
  async clearPublish(user: SessionUser | null | undefined, id: string): Promise<Note> {
    const storage = await this.storageManager.resolve(user);
    const ns = this.namespace(storage, user);
    const driver = storage.driver;
    const current = await this.get(user, id);
    if (current.kind !== 'note') {
      throw new StorageError('只有笔记可以发布', 400, 'not_a_note');
    }
    const doc = parseDocument(await driver.readText(current.path));
    const attributes: Record<string, unknown> = { ...doc.attributes };
    for (const key of PUBLISH_KEYS) delete attributes[key];
    const now = new Date();
    attributes.updated = now.toISOString();
    const raw = serialiseDocument(attributes, doc.body);
    await driver.write(current.path, raw, { modified: now, contentType: 'text/markdown; charset=utf-8' });

    this.invalidate(ns);
    const note = this.buildNote(current.path, raw, { size: raw.length, modified: now.getTime() });
    this.cacheFor(ns).set(current.path, { note, size: raw.length, modified: now.getTime() });
    log.info(`cleared publish info of ${current.path}`);
    return note;
  }

  /**
   * A file's two editable properties: what it is called and where it lives.
   *
   * Both are the same pair of filesystem primitives - `rename` reaches a
   * sibling and `move` carries the name to another directory - so a request
   * that changes both is done as rename-then-move. Everything else in the patch
   * is ignored on purpose: there is nowhere on a picture to record a tag.
   */
  private async updateFile(storage: ResolvedStorage, ns: string, current: Note, patch: NotePatch): Promise<Note> {
    const driver = storage.driver;
    const currentDir = parentPath(current.path);
    const folder = patch.folder !== undefined ? normaliseFolder(patch.folder) : current.folder;
    const dir = folder ? `/${folder}` : '/';
    const currentName = baseName(current.path);
    const extension = fileExtension(currentName);

    const moving = dir !== currentDir;
    const title = (patch.title ?? '').trim();
    let wanted = currentName;
    if (title && title !== current.title) {
      wanted = `${sanitiseFileName(title, stripExtension(currentName) || 'file')}${extension}`;
    }

    // A file that is renamed and moved in one request needs a name free on both
    // sides: `rename` overwrites a sibling, and `move` refuses a destination
    // that is already taken. `self` keeps the file from blocking its own rename.
    let name = wanted;
    if (wanted !== currentName || moving) {
      name = await this.pickFreeFileName(driver, dir, wanted, {
        also: moving ? currentDir : undefined,
        self: current.path,
      });
    }
    if (name === currentName && !moving) {
      // A patch that touches neither is a no-op, exactly as the UI expects.
      return current;
    }
    if (moving && folder) await driver.ensureDir(dir);
    // Rename first, then move: `rename` only reaches a sibling, and the name it
    // lands on has been checked against the destination as well.
    if (name !== currentName) await driver.rename(current.path, name);
    if (moving) await driver.move(joinPath(currentDir, name), dir);

    this.invalidate(ns);
    const path = joinPath(dir, name);
    const now = new Date();
    log.info(`updated file ${current.path} -> ${path}`);
    return this.buildFileSummary(
      { path, size: current.size, modified: now.getTime(), kind: current.kind },
      // The file has not been rewritten, so its creation time still stands.
      { created: current.created },
    );
  }

  /**
   * The name a note gets while it waits in the trash.
   *
   * The id suffix is what lets two notes of the same name sit there together,
   * and it is what `restore()` strips off again.
   *
   * The extension is always `.md`, whatever the note was called before: the
   * original file name is not remembered anywhere, so a `.markdown` note that
   * goes through the trash comes back as `.md`. It is the same note either way
   * - the front matter, the id and the body all survive - but it is a rename
   * nobody asked for, and worth knowing about.
   */
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
    // A local guest reads somebody else's disk: the local driver has no
    // per-user permissions to consult, so the route's refusal is reflected here
    // rather than left for the interface to discover by being told no.
    const readOnlyGuest = user?.guest === true && user.provider === 'local';
    return {
      driver: storage.kind,
      root: storage.displayRoot,
      // the backend's own answer wins; the permission bits are the fallback
      writable: readOnlyGuest ? false : (storage.driver.writable ?? byPermission),
      permissions,
    };
  }

  /**
   * Deletes a note or a file.
   *
   * The id of what now holds it comes back with the answer: a file's id is
   * derived from its path (it has no front matter to carry one), so moving it
   * into the trash changes it - and the undo that follows has to address the
   * copy in the trash, not the path it used to be at.
   */
  async remove(
    user: SessionUser | null | undefined,
    id: string,
    permanent = false,
  ): Promise<{ trashed: boolean; id: string }> {
    const storage = await this.storageManager.resolve(user);
    const ns = this.namespace(storage, user);
    const driver = storage.driver;
    const note = await this.locate(user, id);

    if (permanent) {
      await driver.removePath(note.path);
      // A trashed file is listed from the manifest, so removing it for good has
      // to take its entry with it - otherwise the trash would keep describing
      // a file that no longer exists.
      await this.forgetFile(storage, note.path);
      this.invalidate(ns);
      log.info(`permanently deleted note ${note.path}`);
      return { trashed: false, id: note.id };
    }

    // A file cannot record its own deletion the way a note does in front
    // matter, so it is moved to the trash and remembered in a manifest.
    if (note.kind !== 'note') return this.trashFile(storage, ns, note);

    const doc = parseDocument(await driver.readText(note.path));
    const attributes: Record<string, unknown> = {
      ...doc.attributes,
      id: note.id,
      title: note.title,
      deletedAt: new Date().toISOString(),
      originFolder: note.folder,
    };
    const raw = serialiseDocument(attributes, doc.body);
    const trashDir = `/${TRASH_DIR}`;
    const currentDir = parentPath(note.path);
    await driver.ensureDir(trashDir);

    // Rename in place, then move the renamed file into the trash - the same two
    // steps as any other relocate, and for the same reason: on OpenList a write
    // is an upload, so "write a copy into the trash and delete the original"
    // would hand the trashed note a new identity and leave a second copy behind
    // whenever the delete did not take. The name has to be free on both sides:
    // `rename` reaches only a sibling, and `move` refuses a taken destination.
    const wantedName = this.trashName(note.path, note.id);
    const trashName = (await this.nameIsFree(driver, [trashDir, currentDir], wantedName, note.path))
      ? wantedName
      : await this.randomFreeName(driver, trashDir, wantedName, { also: currentDir, self: note.path });
    if (trashName !== baseName(note.path)) await driver.rename(note.path, trashName);
    await driver.move(joinPath(currentDir, trashName), trashDir);

    // The deletion marks are written last, on the file that is already there:
    // the bytes travel with the file, only the front matter changes.
    const trashPath = joinPath(trashDir, trashName);
    await driver.write(trashPath, raw, { modified: new Date(), contentType: 'text/markdown; charset=utf-8' });
    this.invalidate(ns);
    log.info(`moved note ${note.path} to trash`);
    return { trashed: true, id: note.id };
  }

  /**
   * Moves a file to `/_trash`, remembering where it came from.
   *
   * The file keeps its own name, so restoring it is a move back rather than a
   * rename. Only a name the trash already holds is changed - and it has to
   * change before the move, because `move` cannot rename and refuses a
   * destination that is taken.
   */
  private async trashFile(storage: ResolvedStorage, ns: string, note: Note): Promise<{ trashed: boolean; id: string }> {
    const driver = storage.driver;
    const trashDir = `/${TRASH_DIR}`;
    const currentDir = parentPath(note.path);
    await driver.ensureDir(trashDir);
    const name = baseName(note.path);

    // `move` keeps the file's own name and refuses a destination that is taken,
    // so a clash in the trash is settled by renaming first - on both sides, since
    // the file has to be out of the way of its own siblings as well.
    let storedName = name;
    if (!(await this.nameIsFree(driver, [trashDir], name, note.path))) {
      storedName = await this.randomFreeName(driver, trashDir, name, { also: currentDir, self: note.path });
      await driver.rename(note.path, storedName);
    }
    await driver.move(joinPath(currentDir, storedName), trashDir);
    const stored = joinPath(trashDir, storedName);

    // Deleting something that is already in the trash updates its entry rather
    // than adding a second one, so the trash never lists the same file twice.
    const manifest = (await this.readFileTrash(storage)).filter((entry) => entry.trashPath !== stored);
    manifest.push({ trashPath: stored, originalPath: note.path, deletedAt: new Date().toISOString() });
    await this.writeFileTrash(storage, manifest);
    this.invalidate(ns);
    log.info(`moved file ${note.path} to trash`);
    // The trash listing derives ids from paths, so this is the id the restored
    // copy will answer to while it waits there.
    return { trashed: true, id: hashId(stored) };
  }

  /** Drops the manifest entry of one trashed file, when it has one. */
  private async forgetFile(storage: ResolvedStorage, trashPath: string): Promise<void> {
    if (!trashPath.startsWith(`/${TRASH_DIR}/`)) return;
    const manifest = await this.readFileTrash(storage);
    const left = manifest.filter((entry) => entry.trashPath !== trashPath);
    if (left.length !== manifest.length) await this.writeFileTrash(storage, left);
  }

  async listTrash(user: SessionUser | null | undefined): Promise<Note[]> {
    const storage = await this.storageManager.resolve(user);
    const ns = `${this.namespace(storage, user)}:trash`;
    const entries = await storage.driver.list(`/${TRASH_DIR}`).catch(() => []);
    const files = entries
      .filter((e) => !e.isDir && !e.name.startsWith('.'))
      .map((e) => ({ path: e.path, size: e.size, modified: e.modified }));
    const notes = await mapLimit(
      files.filter((file) => isNoteFile(baseName(file.path))),
      READ_CONCURRENCY,
      (file) => this.loadNote(storage, ns, file),
    );
    const listed = notes.filter((n): n is Note => Boolean(n));

    // Files cannot say "I am in the trash" themselves, so the manifest does.
    // An entry whose file is gone was removed outside the app: it is dropped
    // rather than listed as a ghost.
    const byPath = new Map(files.map((file) => [file.path, file]));
    const manifest = await this.readFileTrash(storage);
    const alive = manifest.filter((entry) => byPath.has(entry.trashPath));
    for (const entry of alive) {
      const file = byPath.get(entry.trashPath) as { path: string; size: number; modified: number };
      listed.push(
        this.buildFileSummary(
          { ...file, kind: kindOf(baseName(entry.originalPath)) },
          { deletedAt: entry.deletedAt, originFolder: folderOf(entry.originalPath) },
        ),
      );
    }
    if (alive.length !== manifest.length) await this.writeFileTrash(storage, alive);

    return listed.sort((a, b) => Date.parse(b.deletedAt ?? b.updated) - Date.parse(a.deletedAt ?? a.updated));
  }

  async restore(user: SessionUser | null | undefined, id: string): Promise<Note> {
    const storage = await this.storageManager.resolve(user);
    const ns = this.namespace(storage, user);
    const driver = storage.driver;
    const trashed = await this.listTrash(user);
    const found = trashed.find((n) => n.id === id);
    if (!found) throw new StorageError(`Note ${id} is not in the trash`, 404, 'note_not_found');
    // A file comes back through the manifest, a note through its front matter.
    if (found.kind !== 'note') return this.restoreFile(storage, ns, found);
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

    // Coming home is a relocate like any other: rename inside the trash (the
    // only place `rename` can reach), then move the renamed file into its
    // folder. Writing a copy and deleting the trashed file would upload the
    // note again - the same defect as renaming by upload, one folder over.
    const trashDir = `/${TRASH_DIR}`;
    // The trash name carries the note's id so two notes of one name can wait
    // there side by side; the note takes its own name back when it leaves. It
    // comes back as `.md` either way (see `trashName`), and a `-2` is chosen
    // when somebody has taken the name in the meantime - never a silent
    // overwrite.
    const storedStem = stripExtension(baseName(found.path));
    const idSuffix = `-${found.id.slice(0, 8)}`;
    const homeStem = storedStem.endsWith(idSuffix) ? storedStem.slice(0, -idSuffix.length) : storedStem;
    const wantedName = await this.pickFileName(driver, dir, homeStem || 'note');
    // Free in the trash as well: `move` refuses a destination that is taken, and
    // the rename that comes before it cannot land on a sibling either.
    const inside = (await this.nameIsFree(driver, [trashDir], wantedName, found.path))
      ? wantedName
      : await this.randomFreeName(driver, trashDir, wantedName, { also: dir, self: found.path });
    if (inside !== baseName(found.path)) await driver.rename(found.path, inside);
    await driver.move(joinPath(trashDir, inside), dir);

    // Only the front matter changes on the way out - the deletion marks go.
    const targetPath = joinPath(dir, inside);
    const raw = serialiseDocument(attributes, doc.body);
    await driver.write(targetPath, raw, { modified: now, contentType: 'text/markdown; charset=utf-8' });
    this.invalidate(ns);
    this.invalidate(`${ns}:trash`);
    return this.buildNote(targetPath, raw, { size: raw.length, modified: now.getTime() });
  }

  /**
   * Puts a trashed file back where it came from.
   *
   * `move` keeps the file's own name, so the name is settled before the move:
   * the original one, or - when something has taken it in the meantime - the
   * next free variant. Restoring never overwrites what is there now.
   */
  private async restoreFile(storage: ResolvedStorage, ns: string, found: Note): Promise<Note> {
    const driver = storage.driver;
    const manifest = await this.readFileTrash(storage);
    const entry = manifest.find((item) => item.trashPath === found.path);
    if (!entry) throw new StorageError('File is not in the trash', 404, 'note_not_found');
    if (!(await driver.exists(entry.trashPath))) {
      await this.writeFileTrash(storage, manifest.filter((item) => item.trashPath !== entry.trashPath));
      throw new StorageError('File is no longer in the trash', 404, 'note_not_found');
    }

    const target = normalisePath(entry.originalPath);
    const dir = parentPath(target);
    if (dir !== '/') await driver.ensureDir(dir);

    let name = baseName(target);
    if (await driver.exists(joinPath(dir, name))) {
      name = await this.pickFreeFileName(driver, dir, name);
    }
    if (name !== baseName(entry.trashPath)) {
      // Rename inside the trash first: the destination name is free by
      // construction, but the trash may already hold it - and then `move` would
      // refuse the destination, so that case gets a suffix of its own.
      const inside = (await driver.exists(joinPath(`/${TRASH_DIR}`, name)))
        ? await this.randomFreeName(driver, `/${TRASH_DIR}`, name, { also: dir })
        : name;
      await driver.rename(entry.trashPath, inside);
      name = inside;
    }
    await driver.move(joinPath(`/${TRASH_DIR}`, name), dir);
    await this.writeFileTrash(
      storage,
      manifest.filter((item) => item.trashPath !== entry.trashPath),
    );

    this.invalidate(ns);
    this.invalidate(`${ns}:trash`);
    const path = joinPath(dir, name);
    log.info(`restored file to ${path}`);
    return this.buildFileSummary({ path, size: found.size, modified: Date.now(), kind: found.kind });
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

    // Trashed files live in `/_trash` itself, so the listing above has already
    // removed them; what is left is the manifest, which would otherwise keep
    // describing files that no longer exist.
    await this.writeFileTrash(storage, []);

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
      // The badge says how many notes are in there; a picture in the same
      // folder is not one of them.
      if (note.kind !== 'note' || !note.folder) continue;
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

  /**
   * Moves a folder - and everything inside it - under another folder.
   *
   * `target` is the destination folder, with `''` meaning the notes root. A
   * folder cannot be moved into itself or into one of its own descendants, and
   * a name already taken at the destination is refused rather than merged: two
   * folders silently becoming one would lose notes.
   */
  async moveFolder(user: SessionUser | null | undefined, folder: string, target: string): Promise<string> {
    const storage = await this.storageManager.resolve(user);
    const driver = storage.driver;
    const clean = normaliseFolder(folder);
    if (!clean) throw new StorageError('Folder name must not be empty', 400, 'invalid_folder');

    // normaliseFolder drops dot-prefixed and `_trash` segments. Here that would
    // quietly send the folder somewhere else, so such a destination is refused.
    const destination = normaliseFolder(target);
    const refused = String(target ?? '')
      .split(/[\\/]+/)
      .some((segment) => {
        const trimmed = segment.trim();
        return trimmed === '.' || trimmed === '..' || trimmed.startsWith('.') || trimmed === TRASH_DIR;
      });
    if (refused) throw new StorageError('目标文件夹无效', 400, 'invalid_folder');
    if (destination === clean || destination.startsWith(`${clean}/`)) {
      throw new StorageError('不能把文件夹移动到它自己或它的子文件夹里', 400, 'invalid_target');
    }

    const path = `/${clean}`;
    if (!(await driver.exists(path))) {
      throw new StorageError('Folder not found', 404, 'folder_not_found');
    }
    if (destination && !(await driver.exists(`/${destination}`))) {
      throw new StorageError(`目标文件夹不存在: ${destination}`, 404, 'folder_not_found');
    }

    const dir = destination ? `/${destination}` : '/';
    const name = baseName(path);
    const newPath = joinPath(dir, name);
    // Dropping a folder into the folder that already holds it changes nothing.
    if (newPath === path) return clean;
    if (await driver.exists(newPath)) {
      throw new StorageError(`已存在名为 ${name} 的文件夹`, 409, 'folder_exists');
    }

    await driver.move(path, dir);
    this.invalidate(this.namespace(storage, user));
    const moved = `${destination ? `${destination}/` : ''}${name}`;
    log.info(`moved folder ${clean} -> ${moved}`);
    return moved;
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

  /** Removes one trashed folder for good. */
  async purgeTrashedFolder(user: SessionUser | null | undefined, trashPath: string): Promise<void> {
    const storage = await this.storageManager.resolve(user);
    const manifest = await this.readFolderTrash(storage);
    const entry = manifest.find((item) => item.path === trashPath);
    if (!entry) throw new StorageError('Folder is not in the trash', 404, 'folder_not_found');
    await storage.driver.removePath(entry.path).catch(() => undefined);
    await this.writeFolderTrash(
      storage,
      manifest.filter((item) => item.path !== trashPath),
    );
    this.invalidate(`${this.namespace(storage, user)}:trash`);
    log.info(`purged trashed folder ${entry.path}`);
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

  /** The file manifest, written beside the folder one and read the same way. */
  private async readFileTrash(storage: ResolvedStorage): Promise<TrashedFile[]> {
    try {
      const raw = await storage.driver.readText(`/${FILE_TRASH_FILE}`);
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (item): item is TrashedFile =>
          Boolean(item) &&
          typeof (item as { trashPath?: unknown }).trashPath === 'string' &&
          typeof (item as { originalPath?: unknown }).originalPath === 'string',
      );
    } catch {
      return [];
    }
  }

  private async writeFileTrash(storage: ResolvedStorage, entries: TrashedFile[]): Promise<void> {
    const path = `/${FILE_TRASH_FILE}`;
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
    // Only notes count: a picture is not a note and has no words to add.
    const notes = (await this.list(user)).filter((note) => note.kind === 'note');
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

  /**
   * Every published note, newest publication first.
   *
   * Only notes: a picture has no front matter to hold the mark, so nothing else
   * can ever be in this list.
   */
  async blogPosts(user: SessionUser | null | undefined): Promise<BlogPostSummary[]> {
    const notes = await this.list(user);
    return notes
      .filter((note) => note.kind === 'note' && note.blog)
      .map((note) => this.toBlogSummary(note))
      .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  }

  /** One published note with its body, or null when there is no such post. */
  async publishedPost(user: SessionUser | null | undefined, storagePath: string): Promise<BlogPost | null> {
    const path = normalisePath(String(storagePath ?? ''));
    if (path === '/') return null;
    const notes = await this.list(user);
    const found = notes.find((note) => note.path === path && note.kind === 'note' && note.blog);
    return found ? { ...this.toBlogSummary(found), content: found.content } : null;
  }

  /**
   * The bytes of one file, if the blog is allowed to serve it.
   *
   * A whitelist rather than a filter: a published note may hand out its own
   * file and the files its body actually points at - the pictures in it - and
   * nothing else. Every other note in the folder keeps its bytes to itself,
   * which is the whole reason the blog cannot just expose the storage root.
   */
  async publishedFile(
    user: SessionUser | null | undefined,
    storagePath: string,
  ): Promise<{ path: string; data: Uint8Array } | null> {
    const path = normalisePath(String(storagePath ?? ''));
    if (path === '/' || path.split('/').some((segment) => segment.startsWith('.'))) return null;
    const notes = await this.list(user);
    const allowed = notes
      .filter((note) => note.kind === 'note' && note.blog)
      .some((post) => post.path === path || referencedPaths(post.content, post.path).includes(path));
    if (!allowed) return null;
    // readBinary re-checks the path, so nothing here can reach outside the root.
    return this.readBinary(user, path);
  }

  /**
   * The publish manager's rows: every note the publish dialog has been used on,
   * published first and then newest first.
   *
   * Unpublished rows stay in the list on purpose - that is what the row is for:
   * finding a post again after it was taken off the blog.
   */
  async publishEntries(user: SessionUser | null | undefined): Promise<PublishEntry[]> {
    const notes = await this.list(user);
    return notes
      .filter((note) => note.kind === 'note' && note.hasPublishInfo)
      .map((note) => ({
        id: note.id,
        path: note.path,
        name: baseName(note.path),
        published: note.blog,
        // A row that is not on the blog has no date to show: the interface
        // prints a dash rather than a misleading one.
        publishedAt: note.blog ? note.blogAt || note.updated || note.created : null,
        title: note.blogTitle || note.title,
        summary: note.blogSummary || toSummaryMarkdown(note.content),
        editedTitle: Boolean(note.blogTitle),
        editedSummary: Boolean(note.blogSummary),
        updatedAt: note.updated,
      }))
      .sort((a, b) => {
        if (a.published !== b.published) return a.published ? -1 : 1;
        const right = Date.parse(b.publishedAt ?? b.updatedAt) || 0;
        const left = Date.parse(a.publishedAt ?? a.updatedAt) || 0;
        return right - left;
      });
  }

  private toBlogSummary(note: Note): BlogPostSummary {
    return {
      id: note.id,
      path: note.path,
      // What the publish dialog wrote wins; the note's own wording is the
      // fallback, so a card is never blank because nobody edited it.
      title: note.blogTitle || note.title,
      summary: note.blogSummary || toSummaryMarkdown(note.content),
      // A note published before the timestamp existed still needs a date; its
      // last change is the closest true answer there is.
      publishedAt: note.blogAt || note.updated || note.created,
      updatedAt: note.updated,
      wordCount: note.wordCount,
      tags: note.tags,
    };
  }

  /** Removes cache entries of storage backends the user can no longer access. */
  clearCaches(): void {
    this.caches.clear();
    this.scans.clear();
  }
}
