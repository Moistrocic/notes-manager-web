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

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.m4v', '.mov', '.ogv']);
const SCENE_EXTENSIONS = new Set(['.pkg']);

export function kindOf(name: string): BackgroundFileKind | null {
  const ext = path.extname(name).toLowerCase();
  if (SCENE_EXTENSIONS.has(ext)) return 'scene';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return null;
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