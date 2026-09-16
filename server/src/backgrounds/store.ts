import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../logger.js';

const log = createLogger('backgrounds');

/** Where an administrator puts the background they want everyone to see. */
export const BACKGROUNDS_DIRNAME = 'backgrounds';
/** Optional file naming which of them to use, and what kind it is. */
const MANIFEST = 'background.json';

export type BackgroundKind = 'image' | 'scene';

export interface BackgroundFile {
  /** File name inside the directory. */
  name: string;
  kind: BackgroundKind;
  bytes: number;
}

export interface BackgroundManifest {
  file?: string;
  kind?: BackgroundKind;
  /** Shown in the settings dialog, for whoever comes along later. */
  note?: string;
}

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);
const SCENE_EXTENSIONS = new Set(['.pkg']);

export function kindOf(name: string): BackgroundKind | null {
  const ext = path.extname(name).toLowerCase();
  if (SCENE_EXTENSIONS.has(ext)) return 'scene';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return null;
}

/**
 * The administrator's default background.
 *
 * A directory rather than an upload: a scene wallpaper is 45 MB, it is the
 * administrator's own file to obtain, and a wallpaper is not something a web
 * form should be moving around. Drop it in, restart, done.
 *
 * The directory sits under the data directory, so it survives an update and is
 * covered by whatever backs that up.
 */
export class BackgroundStore {
  readonly dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, BACKGROUNDS_DIRNAME);
  }

  private readManifest(): BackgroundManifest {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(this.dir, MANIFEST), 'utf8')) as BackgroundManifest;
      return raw && typeof raw === 'object' ? raw : {};
    } catch {
      return {};
    }
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

  /** The file to serve, or null when the administrator has not set one. */
  pick(): BackgroundFile | null {
    const files = this.list();
    if (files.length === 0) return null;
    const manifest = this.readManifest();
    if (manifest.file) {
      const named = files.find((f) => f.name === manifest.file);
      if (named) return manifest.kind ? { ...named, kind: manifest.kind } : named;
      log.warn(`${MANIFEST} names "${manifest.file}", which is not in ${this.dir}`);
    }
    return files[0] ?? null;
  }

  manifest(): BackgroundManifest {
    return this.readManifest();
  }

  /** Absolute path of a file in the directory, or null if it is not one. */
  resolve(name: string): string | null {
    if (!name || name.includes('/') || name.includes('\\') || name.startsWith('.')) return null;
    const picked = this.list().find((f) => f.name === name);
    return picked ? path.join(this.dir, picked.name) : null;
  }

  contentType(file: BackgroundFile): string {
    if (file.kind === 'scene') return 'application/octet-stream';
    const ext = path.extname(file.name).toLowerCase();
    if (ext === '.png') return 'image/png';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.gif') return 'image/gif';
    if (ext === '.avif') return 'image/avif';
    return 'image/jpeg';
  }
}
