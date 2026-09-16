/**
 * Wallpaper support, entirely client side.
 *
 * A wallpaper is a personal preference, so nothing is uploaded: a URL is stored
 * in localStorage and a file is kept in IndexedDB as a blob. The server never
 * learns about either, which is also why this works for every account.
 */

/**
 * "scene" is a Wallpaper Engine scene.pkg kept as-is and rendered live, rather
 * than a picture: the file stored is the container, not an image.
 */
export type WallpaperKind = 'none' | 'image' | 'video' | 'scene';
/** Where the current wallpaper came from. "library" means a local folder. */
export type WallpaperSource = 'url' | 'file' | 'library';

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The whole picture. */
export const FULL_CROP: CropRect = { x: 0, y: 0, w: 1, h: 1 };

/** The smallest selection the editor will produce, in either axis. */
export const MIN_CROP = 0.08;

export interface WallpaperSettings {
  kind: WallpaperKind;
  source: WallpaperSource;
  /** Used when source is "url". */
  url: string;
  /** Backdrop blur in px. */
  blur: number;
  /** Darkening scrim, 0 - 0.85. */
  dim: number;
  /**
   * The part of the picture that fills the screen, in picture coordinates:
   * x/y are the top-left corner and w/h the size, all 0-1. The whole picture is
   * {x:0, y:0, w:1, h:1}.
   *
   * This replaced a zoom factor plus an object-position pair. Those two are not
   * independent - zooming scales about the element's centre and drags the
   * chosen region with it - so after zooming, the region you picked was no
   * longer the region you got. A rectangle has no such ambiguity: it is the
   * region, and it always fills the screen exactly.
   */
  crop: CropRect;
  /**
   * Render scene wallpapers live instead of compositing one frame. Off by
   * default: the still costs nothing to keep on screen, a live scene holds a
   * GPU context and draws continuously.
   */
  dynamicScene: boolean;
  /**
   * Tints for the built-in background, which is otherwise the theme's two
   * accent colours. Empty means "use the theme".
   */
  auroraA: string;
  auroraB: string;
  /** Take the interface colour from the wallpaper. On unless turned off. */
  autoAccent: boolean;
  /** The colour to use when autoAccent is off. Empty means the theme's own. */
  accentColor: string;
}

export const DEFAULT_WALLPAPER: WallpaperSettings = {
  kind: 'none',
  source: 'url',
  url: '',
  blur: 0,
  dim: 0.35,
  crop: { ...FULL_CROP },
  dynamicScene: false,
  auroraA: '',
  auroraB: '',
  autoAccent: true,
  accentColor: '',
};

/**
 * Positions a media element so the crop rectangle fills its container.
 *
 * Scale up by 1/w and 1/h, then shift left and up so the rectangle's top-left
 * corner lands on the container's. Used by the background layer and by the
 * dialog's preview, so the two can never disagree about the framing.
 */
export function cropMediaStyle(crop: CropRect): {
  position: 'absolute';
  width: string;
  height: string;
  left: string;
  top: string;
} {
  return {
    position: 'absolute',
    width: `${100 / crop.w}%`,
    height: `${100 / crop.h}%`,
    left: `${-(crop.x / crop.w) * 100}%`,
    top: `${-(crop.y / crop.h) * 100}%`,
  };
}

export type CropHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

/**
 * The rectangle after dragging one handle, given the movement in picture units.
 *
 * The two families behave differently on purpose. An edge moves one side and
 * leaves the other axis alone, so a selection can be made wider without also
 * becoming taller. A corner scales both axes by the same factor, anchored at the
 * opposite corner, so the shape survives being made bigger or smaller - with
 * edges alone there would be no way to resize without drifting the aspect ratio.
 *
 * Kept here rather than in the component so it can be reasoned about, and
 * tested, without pointer events.
 */
export function resizeCrop(start: CropRect, handle: CropHandle, dx: number, dy: number): CropRect {
  if (handle === 'move') return clampCrop({ ...start, x: start.x + dx, y: start.y + dy });

  const west = handle.includes('w');
  const east = handle.includes('e');
  const north = handle.includes('n');
  const south = handle.includes('s');

  // How far the selection may grow before the side being dragged would leave
  // the picture. The opposite side is anchored, so the room available is
  // measured from it rather than from the picture's edge in general.
  const roomW = west ? start.x + start.w : 1 - start.x;
  const roomH = north ? start.y + start.h : 1 - start.y;

  if ((west || east) && (north || south)) {
    // One factor for both axes, so it has to answer to whichever of them the
    // pointer is asking for more. Reading only the horizontal delta made a
    // corner dragged straight down do nothing at all.
    const scaleX = (west ? start.w - dx : start.w + dx) / start.w;
    const scaleY = (north ? start.h - dy : start.h + dy) / start.h;
    const asked = Math.abs(scaleX - 1) >= Math.abs(scaleY - 1) ? scaleX : scaleY;
    // And it has to satisfy both axes at once. Capping only the width
    // afterwards - which is what clamping the result did - left the height at
    // the size the factor asked for, so a corner held against an edge kept
    // growing the other way.
    const factor = Math.max(
      MIN_CROP / start.w,
      MIN_CROP / start.h,
      Math.min(asked, roomW / start.w, roomH / start.h),
    );
    const w = start.w * factor;
    const h = start.h * factor;
    return clampCrop({
      w,
      h,
      x: west ? start.x + (start.w - w) : start.x,
      y: north ? start.y + (start.h - h) : start.y,
    });
  }

  let { x, y, w, h } = start;
  // An edge moves one side and holds the other. Without the cap, dragging the
  // west edge left past the picture's edge pushed the east edge along with it.
  if (west) {
    w = Math.min(start.w - dx, roomW);
    x = start.x + start.w - w;
  }
  if (east) w = Math.min(start.w + dx, roomW);
  if (north) {
    h = Math.min(start.h - dy, roomH);
    y = start.y + start.h - h;
  }
  if (south) h = Math.min(start.h + dy, roomH);
  // Applied after the caps, so a side dragged past the opposite one stops at
  // the minimum instead of turning the rectangle inside out.
  if (w < MIN_CROP) {
    w = MIN_CROP;
    if (west) x = start.x + start.w - MIN_CROP;
  }
  if (h < MIN_CROP) {
    h = MIN_CROP;
    if (north) y = start.y + start.h - MIN_CROP;
  }
  return clampCrop({ x, y, w, h });
}

/** Keeps a rectangle inside the picture and above the minimum size. */
export function clampCrop(rect: CropRect): CropRect {
  const w = Math.min(1, Math.max(MIN_CROP, rect.w));
  const h = Math.min(1, Math.max(MIN_CROP, rect.h));
  return {
    w,
    h,
    x: Math.min(1 - w, Math.max(0, rect.x)),
    y: Math.min(1 - h, Math.max(0, rect.y)),
  };
}

/** The common shapes, as a starting point for a wallpaper that does not fit. */
export const CROP_PRESETS: { label: string; ratio: number | null }[] = [
  { label: '整张', ratio: null },
  { label: '16:9', ratio: 16 / 9 },
  { label: '16:10', ratio: 16 / 10 },
  { label: '21:9', ratio: 21 / 9 },
  { label: '4:3', ratio: 4 / 3 },
  { label: '1:1', ratio: 1 },
];

/** The largest centred rectangle of `ratio` that fits in the picture. */
export function cropForRatio(ratio: number | null, imageAspect: number): CropRect {
  if (ratio === null) return { ...FULL_CROP };
  // Normalised coordinates: the picture is 1 wide and 1 tall regardless of its
  // real shape, so the ratio has to be expressed against the picture's aspect.
  const wanted = ratio / imageAspect;
  if (wanted >= 1) {
    const h = 1 / wanted;
    return { x: 0, y: (1 - h) / 2, w: 1, h };
  }
  return { x: (1 - wanted) / 2, y: 0, w: wanted, h: 1 };
}

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
      crop: readCrop(parsed as Record<string, unknown>),
      dynamicScene: parsed.dynamicScene === true,
      auroraA: typeof parsed.auroraA === 'string' ? parsed.auroraA : '',
      auroraB: typeof parsed.auroraB === 'string' ? parsed.auroraB : '',
      autoAccent: parsed.autoAccent !== false,
      accentColor: typeof parsed.accentColor === 'string' ? parsed.accentColor : '',
    };
  } catch {
    return { ...DEFAULT_WALLPAPER };
  }
}

/**
 * The selection, from whatever the stored settings happen to hold.
 *
 * Settings written before the crop box existed carry a zoom factor and an
 * object-position pair instead. Those are converted rather than discarded, so
 * an existing wallpaper keeps roughly the framing it had: a zoom of 2 becomes a
 * half-size box centred on the old anchor point.
 */
function readCrop(raw: Record<string, unknown>): CropRect {
  const stored = raw.crop as Partial<CropRect> | undefined;
  if (stored && ['x', 'y', 'w', 'h'].every((key) => Number.isFinite(Number((stored as never)[key])))) {
    return clampCrop({ x: Number(stored.x), y: Number(stored.y), w: Number(stored.w), h: Number(stored.h) });
  }

  const zoom = clamp(Number(raw.scale ?? 1), 1, 2);
  if (zoom <= 1) return { ...FULL_CROP };
  const size = 1 / zoom;
  const anchorX = clamp(Number(raw.focusX ?? 50), 0, 100) / 100;
  const anchorY = clamp(Number(raw.focusY ?? 50), 0, 100) / 100;
  return clampCrop({ w: size, h: size, x: anchorX * (1 - size), y: anchorY * (1 - size) });
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
  if (name.toLowerCase().endsWith('.pkg')) return null;
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (WALLPAPER_IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (WALLPAPER_VIDEO_EXTENSIONS.includes(ext)) return 'video';
  return null;
}
