import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../logger.js';
import type { BackgroundKind, BackgroundSettings, SettingsStore } from '../config.js';

const log = createLogger('backgrounds');

/** Where an administrator puts the background they want everyone to see. */
export const BACKGROUNDS_DIRNAME = 'backgrounds';
/**
 * A hand written selection, from before this was a setting.
 *
 * It is read once (`adoptManifest`) and renamed, so that what the settings say
 * is the only thing that decides afterwards - including when it says there is
 * no default background at all.
 */
const MANIFEST = 'background.json';
const MANIFEST_ADOPTED = 'background.json.imported';

/** What a file in the folder is, from its extension. */
export type BackgroundFileKind = 'image' | 'video' | 'scene';

/** Why a background file could not be deleted, in the words the route answers with. */
export type BackgroundRemoveErrorCode = 'invalid_background_name' | 'background_not_found';

/**
 * A refused delete: the name is not something this folder may delete, or there
 * is nothing there any more. The route turns the code into 400 or 404.
 */
export class BackgroundRemoveError extends Error {
  readonly code: BackgroundRemoveErrorCode;

  constructor(message: string, code: BackgroundRemoveErrorCode) {
    super(message);
    this.name = 'BackgroundRemoveError';
    this.code = code;
  }
}

export interface BackgroundFile {
  /** File name inside the directory. */
  name: string;
  kind: BackgroundFileKind;
  bytes: number;
}

export interface BackgroundManifest {
  file?: string;
  kind?: BackgroundFileKind;
  /** Shown in the settings dialog, for whoever comes along later. */
  note?: string;
}

/**
 * The largest picture an administrator may upload.
 *
 * The browser shrinks the file before uploading (long edge 2560, WebP), so a
 * real request is a few hundred kilobytes; this ceiling is for a client that
 * does not shrink - curl, an old tab - not for the normal path.
 */
export const MAX_BACKGROUND_BYTES = 20 * 1024 * 1024;

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.m4v', '.mov', '.ogv']);
const SCENE_EXTENSIONS = new Set(['.pkg']);

/** The image format, read from the first bytes of an upload. */
export function sniffImageType(data: Buffer): 'png' | 'jpeg' | 'gif' | 'webp' | null {
  if (!data || data.length < 12) return null;
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'png';
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg';
  if (data.subarray(0, 3).toString('latin1') === 'GIF') return 'gif';
  if (data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/** The extension a sniffed format is stored under. */
const TYPE_EXTENSIONS: Record<'png' | 'jpeg' | 'gif' | 'webp', string> = {
  png: '.png',
  jpeg: '.jpg',
  gif: '.gif',
  webp: '.webp',
};

/**
 * A file name that is safe to write and still recognisable.
 *
 * The browser sends whatever the file was called; it is only a label. Path
 * separators are dropped by `basename`, characters that are hostile to a file
 * system become dashes, a leading dot cannot turn it into a hidden file, and
 * the extension is chosen by the bytes (see save) - so a .png that is really a
 * JPEG is not served with the wrong Content-Type for the rest of its life.
 */
function safeBackgroundName(raw: string, extension: string): string {
  const base = path.basename((raw || '').replace(/\\/g, '/'));
  const stem = base.replace(/\.[^.]*$/, '');
  const cleaned = stem
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/[\u0000-\u001f]+/g, '')
    .replace(/^\.+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .trim();
  return `${cleaned || `background-${Date.now()}`}${extension}`;
}

export function kindOf(name: string): BackgroundFileKind | null {
  const ext = path.extname(name).toLowerCase();
  if (SCENE_EXTENSIONS.has(ext)) return 'scene';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return null;
}

/**
 * Whether a name is one this folder may delete.
 *
 * A bare file name with a background extension, and nothing that means "some
 * other path": no separators, no leading dot (the manifest and dot files stay
 * hidden), no control characters. `path.basename` is the guard against the
 * separators, and the extension check keeps the folder's own bookkeeping files
 * out of reach.
 */
function isRemovableName(name: string): boolean {
  if (!name || name.length > 255) return false;
  if (name.startsWith('.') || name.includes('/') || name.includes('\\')) return false;
  if (/[\u0000-\u001f]/.test(name)) return false;
  if (path.basename(name) !== name) return false;
  return kindOf(name) !== null;
}

/**
 * The administrator's default background.
 *
 * Files, not uploads: a scene wallpaper is 45 MB, it is the administrator's own
 * file to obtain, and a wallpaper is not something a web form should be moving
 * around. Drop it in, then choose it - and how it should look - in the
 * settings dialog.
 *
 * The directory sits under the data directory, so it survives an update and is
 * covered by whatever backs that up.
 */
export class BackgroundStore {
  readonly dir: string;
  /** Content hashes, keyed by name, size and modification time. */
  private readonly hashes = new Map<string, string>();

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, BACKGROUNDS_DIRNAME);
  }

  /** Every usable file in the directory, in a stable order. */
  list(): BackgroundFile[] {
    let names: string[];
    try {
      names = fs.readdirSync(this.dir);
    } catch {
      return [];
    }
    const out: BackgroundFile[] = [];
    for (const name of names.sort()) {
      if (name.startsWith('.')) continue;
      const kind = kindOf(name);
      if (!kind) continue;
      try {
        const stat = fs.statSync(path.join(this.dir, name));
        if (stat.isFile()) out.push({ name, kind, bytes: stat.size });
      } catch {
        /* vanished between the listing and the stat */
      }
    }
    // Scenes first: they are the interesting case, and a directory holding both
    // is almost certainly one where the scene is the intended background.
    return out.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'scene' ? -1 : 1));
  }

  /** The file a name refers to, or null when the directory has no such file. */
  find(name: string | undefined): BackgroundFile | null {
    if (!name) return null;
    return this.list().find((file) => file.name === name) ?? null;
  }

  /** Absolute path of a file in the directory, or null if it is not one. */
  resolve(name: string): string | null {
    if (!name || name.includes('/') || name.includes('\\') || name.startsWith('.')) return null;
    const found = this.find(name);
    return found ? path.join(this.dir, found.name) : null;
  }

  /**
   * Deletes a file from the folder.
   *
   * A file the listing would show, and only that: the name has to be a bare file
   * name with a background extension, so a crafted query cannot reach outside
   * `backgrounds/` or delete the folder's own bookkeeping. Symlinks are refused
   * too - they are not the file they appear to be.
   *
   * Throws `BackgroundRemoveError`: `invalid_background_name` for a name this
   * folder may never delete, `background_not_found` when there is nothing there.
   * A permission failure is left as a plain error (it is a 500, not a 404).
   */
  remove(name: string): BackgroundFile {
    if (!isRemovableName(name)) {
      throw new BackgroundRemoveError(`不是可删除的背景文件名：${name || '(空)'}`, 'invalid_background_name');
    }
    const absolute = path.join(this.dir, name);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(absolute);
    } catch {
      throw new BackgroundRemoveError(`背景文件不存在：${name}`, 'background_not_found');
    }
    if (!stat.isFile()) {
      throw new BackgroundRemoveError(`背景文件不存在：${name}`, 'background_not_found');
    }
    try {
      fs.unlinkSync(absolute);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new BackgroundRemoveError(`背景文件不存在：${name}`, 'background_not_found');
      }
      throw err;
    }
    // The hash cache is keyed by name + size + mtime; the name may come back as
    // another file, so nothing about this one is worth remembering.
    for (const key of this.hashes.keys()) {
      if (key.startsWith(`${name}:`)) this.hashes.delete(key);
    }
    log.info(`background removed: ${name} (${stat.size} bytes)`);
    return { name, kind: kindOf(name) ?? 'image', bytes: stat.size };
  }

  /**
   * A fingerprint of a file's contents, for cache keys.
   *
   * A wallpaper is 45 MB, so the browser must be able to keep it and know when
   * it is out of date - which a name cannot say (the file can be replaced under
   * the same name) and a timestamp cannot say reliably. The hash is computed
   * once per version and kept in memory: the answer only depends on the size and
   * modification time, so a request for an unchanged file is a stat.
   */
  hash(name: string): Promise<string | null> {
    const found = this.find(name);
    if (!found) return Promise.resolve(null);
    const absolute = path.join(this.dir, found.name);
    const stamp = `${found.name}:${found.bytes}:${this.mtimeOf(absolute)}`;
    const remembered = this.hashes.get(stamp);
    if (remembered) return Promise.resolve(remembered);
    return new Promise((resolve) => {
      const digest = crypto.createHash('sha256');
      const stream = fs.createReadStream(absolute);
      stream.on('data', (chunk) => digest.update(chunk));
      stream.on('error', () => resolve(null));
      stream.on('end', () => {
        const value = digest.digest('hex').slice(0, 32);
        this.hashes.set(stamp, value);
        resolve(value);
      });
    });
  }

  private mtimeOf(absolute: string): number {
    try {
      return fs.statSync(absolute).mtimeMs;
    } catch {
      return 0;
    }
  }

  /**
   * Stores an uploaded picture and returns it as the folder listing would.
   *
   * The format comes from the bytes rather than from the request's name: the
   * extension has to match what will actually be served, or the browser refuses
   * to draw it. A file of the same name is replaced - the administrator is
   * uploading into the same slot, and the saved settings keep pointing at it.
   */
  save(rawName: string, data: Buffer): BackgroundFile {
    if (!data || data.length === 0) throw new Error('没有收到图片数据');
    if (data.length > MAX_BACKGROUND_BYTES) throw new Error('背景图片太大（上限 20 MB）');
    const type = sniffImageType(data);
    if (!type) throw new Error('只支持 PNG / JPEG / WebP / GIF 图片');
    fs.mkdirSync(this.dir, { recursive: true });
    const name = safeBackgroundName(rawName, TYPE_EXTENSIONS[type]);
    const absolute = path.join(this.dir, name);
    // Written under a temporary name and renamed, so a failed write never
    // leaves a half picture where a background used to be.
    const temporary = path.join(this.dir, `.${name}.upload`);
    fs.writeFileSync(temporary, data);
    fs.renameSync(temporary, absolute);
    log.info(`background saved: ${name} (${data.length} bytes)`);
    return { name, kind: 'image', bytes: data.length };
  }

  contentType(file: BackgroundFile): string {
    const ext = path.extname(file.name).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.avif') return 'image/avif';
    if (ext === '.mp4' || ext === '.m4v') return 'video/mp4';
    if (ext === '.webm') return 'video/webm';
    if (ext === '.mov') return 'video/quicktime';
    if (ext === '.ogv') return 'video/ogg';
    if (ext === '.pkg') return 'application/octet-stream';
    return 'image/jpeg';
  }

  /** Reads the hand written selection, and marks it as taken. */
  takeManifest(): BackgroundManifest | null {
    const file = path.join(this.dir, MANIFEST);
    let manifest: BackgroundManifest;
    try {
      manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as BackgroundManifest;
    } catch {
      return null;
    }
    if (!manifest || typeof manifest !== 'object' || !manifest.file) return null;
    try {
      fs.renameSync(file, path.join(this.dir, MANIFEST_ADOPTED));
    } catch (err) {
      log.warn(`could not rename ${MANIFEST}: ${(err as Error).message}`);
    }
    return manifest;
  }
}

/**
 * Moves a hand written `background.json` into the settings, once.
 *
 * Deployments that predate the settings section have one, and it would be a
 * poor welcome to silently stop honouring it. It is imported only when nothing
 * has been configured yet, and only once - so an administrator who chooses
 * 「不设置」 afterwards gets what they asked for rather than the old file back.
 */
export function adoptManifest(settings: SettingsStore, store: BackgroundStore): void {
  const background = settings.raw().background;
  if (background.kind !== 'off' || background.file) return;
  const manifest = store.takeManifest();
  if (!manifest?.file) return;
  const file = store.find(manifest.file);
  if (!file) {
    log.warn(`${MANIFEST} names "${manifest.file}", which is not in ${store.dir}`);
    return;
  }
  const kind: BackgroundKind = manifest.kind ?? file.kind;
  // Only the fields the import actually knows; the rest keep their defaults.
  settings.update({ background: { ...background, kind, file: file.name, note: manifest.note ?? '' } });
  log.info(`imported ${MANIFEST}: ${file.name} as ${kind}`);
}