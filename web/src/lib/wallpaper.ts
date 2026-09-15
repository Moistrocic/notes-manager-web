/**
 * Wallpaper support, entirely client side.
 *
 * A wallpaper is a personal preference, so nothing is uploaded: a URL is stored
 * in localStorage and a file is kept in IndexedDB as a blob. The server never
 * learns about either, which is also why this works for every account.
 */

export type WallpaperKind = 'none' | 'image' | 'video';
/** Where the current wallpaper came from. "library" means a local folder. */
export type WallpaperSource = 'url' | 'file' | 'library';

export interface WallpaperSettings {
  kind: WallpaperKind;
  source: WallpaperSource;
  /** Used when source is "url". */
  url: string;
  /** Backdrop blur in px. */
  blur: number;
  /** Darkening scrim, 0 - 0.85. */
  dim: number;
  /** Extra zoom for cover fitting, 1 - 2. */
  scale: number;
  /**
   * Which part of the picture to keep when cover has to crop it, as a
   * percentage of the leftover. 50/50 is centred; a square wallpaper on a wide
   * screen needs this to choose its horizontal band.
   */
  focusX: number;
  focusY: number;
}

export const DEFAULT_WALLPAPER: WallpaperSettings = {
  kind: 'none',
  source: 'url',
  url: '',
  blur: 0,
  dim: 0.35,
  scale: 1,
  focusX: 50,
  focusY: 50,
};

/** The nine positions most people pick from, top-left to bottom-right. */
export const FOCUS_PRESETS: { x: number; y: number; label: string }[] = [
  { x: 0, y: 0, label: '左上' },
  { x: 50, y: 0, label: '上' },
  { x: 100, y: 0, label: '右上' },
  { x: 0, y: 50, label: '左' },
  { x: 50, y: 50, label: '居中' },
  { x: 100, y: 50, label: '右' },
  { x: 0, y: 100, label: '左下' },
  { x: 50, y: 100, label: '下' },
  { x: 100, y: 100, label: '右下' },
];

const SETTINGS_KEY = 'notes-manager-wallpaper';
const DB_NAME = 'notes-manager';
const DB_STORE = 'wallpaper';
const FILE_KEY = 'current';

export function loadWallpaperSettings(): WallpaperSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_WALLPAPER };
    const parsed = JSON.parse(raw) as Partial<WallpaperSettings>;
    return {
      ...DEFAULT_WALLPAPER,
      ...parsed,
      blur: clamp(Number(parsed.blur ?? 0), 0, 40),
      dim: clamp(Number(parsed.dim ?? DEFAULT_WALLPAPER.dim), 0, 0.85),
      scale: clamp(Number(parsed.scale ?? 1), 1, 2),
      // Missing on anything saved before the framing controls existed, and
      // centred is the right default for those.
      focusX: clamp(Number(parsed.focusX ?? 50), 0, 100),
      focusY: clamp(Number(parsed.focusY ?? 50), 0, 100),
    };
  } catch {
    return { ...DEFAULT_WALLPAPER };
  }
}

export function saveWallpaperSettings(settings: WallpaperSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* private mode, quota, ... - the wallpaper just will not persist */
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/* -------------------------------------------------------------------------- */
/* IndexedDB, for the local file                                              */
/* -------------------------------------------------------------------------- */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available here'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, mode);
    const request = run(transaction.objectStore(DB_STORE));
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
  });
}

/* Generic access to the same store, for the pieces other modules keep there
 * (the wallpaper folder handle, for one). */
/** Best effort: a browser without IndexedDB just loses the memory. */
export async function idbPut(key: string, value: unknown): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.put(value, key));
  } catch {
    /* private mode, no IndexedDB, quota, ... */
  }
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  try {
    return await withStore<T | undefined>('readonly', (store) => store.get(key));
  } catch {
    return undefined;
  }
}

export async function idbDelete(key: string): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.delete(key));
  } catch {
    /* nothing stored */
  }
}

export async function saveWallpaperFile(file: File): Promise<void> {
  await withStore('readwrite', (store) => store.put(file, FILE_KEY));
}

export async function loadWallpaperFile(): Promise<Blob | null> {
  try {
    const blob = await withStore<Blob | undefined>('readonly', (store) => store.get(FILE_KEY));
    return blob ?? null;
  } catch {
    return null;
  }
}

export async function clearWallpaperFile(): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.delete(FILE_KEY));
  } catch {
    /* nothing stored */
  }
}

/** A blob URL for the stored file, or null when there is none. */
export async function wallpaperObjectUrl(): Promise<string | null> {
  const blob = await loadWallpaperFile();
  return blob ? URL.createObjectURL(blob) : null;
}

/**
 * Picks a wallpaper file, keeping only what the browser can actually render.
 * Animated GIFs and WebP work as images; everything else has to be a video.
 */
export function acceptFor(kind: WallpaperKind): string {
  if (kind === 'video') return 'video/*';
  return 'image/*';
}

/** Extensions the browser can put on screen. */
export const WALLPAPER_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'svg'];
export const WALLPAPER_VIDEO_EXTENSIONS = ['mp4', 'webm', 'm4v', 'mov', 'ogv'];

/** image, video, or null when the file is not something a browser can show. */
export function wallpaperKindOf(name: string): 'image' | 'video' | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (WALLPAPER_IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (WALLPAPER_VIDEO_EXTENSIONS.includes(ext)) return 'video';
  return null;
}
