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
 *
 * "custom" is an imported picture that drifts slowly while particles float over
 * it - and, with no picture, the two-colour field the first version drew. The
 * picture is downscaled and re-encoded in the browser before it is stored (see
 * shrinkWallpaperImage), so an animated-looking background costs a few hundred
 * kilobytes instead of the twenty megabytes the file manager handed over.
 */
export type WallpaperKind = 'none' | 'image' | 'video' | 'scene' | 'custom';
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
  /**
   * Use the background the administrator set for everyone. On by default, and
   * the user can turn it off to choose their own.
   */
  useAdminBackground: boolean;
  /** Take the interface colour from the wallpaper. On unless turned off. */
  autoAccent: boolean;
  /** The colour to use when autoAccent is off. Empty means the theme's own. */
  accentColor: string;

  /* The custom wallpaper's palette, its motion, and its particles. */
  /** First colour of the still field; empty means the theme's accent. */
  customA: string;
  /** Second colour of the still field; empty means the theme's secondary accent. */
  customB: string;
  /** How far the picture (or colour field) wanders, 0 - 1. */
  customDrift: number;
  /** How fast it wanders, 0.2 - 2 (1 is the designed pace). */
  customSpeed: number;
  /**
   * The particle system, tuned against the Wallpaper Engine defaults this
   * repository's own scene renderer implements (see
   * lib/wallpaper-scene-layers/.../render/particles.ts and particle-defaults.ts).
   * They are optional because settings files written before v2 have none of
   * them: resolveCustomWallpaper() fills in and clamps the real values.
   */
  /** How many particles: 0 - CUSTOM_MAX_PARTICLES. */
  customDensity?: number;
  /** Particle radius in CSS pixels, 0.6 - 6. */
  customParticleSize?: number;
  /** How opaque a particle starts, 0.05 - 1. */
  customParticleOpacity?: number;
  /** Particle lifetime in seconds, 1 - 12. */
  customParticleLife?: number;
  /** How fast particles travel, 0 - 120 px/s. */
  customParticleSpeed?: number;
  /** How strongly the curl-noise field stirs them, 0 - 1. */
  customParticleTurbulence?: number;
  /** Particle colour; empty means the theme's accent. */
  customParticleColor?: string;
  /** Direction of the drift in degrees: 90 is upward, 0 is to the right. */
  customParticleWind?: number;
}

/**
 * The custom wallpaper's defaults.
 *
 * Where a number can be traced to Wallpaper Engine's own defaults (this
 * repository re-implements its particle system in
 * lib/wallpaper-scene-layers/.../render/particles.ts), the source is written
 * next to it; the rest are chosen for how they look over a photograph.
 */
export const CUSTOM_DEFAULTS = {
  /** The drawn field's sway; the picture's is the same knob. */
  drift: 0.5,
  /** Pace multiplier: 0.2 is a slow crawl, 2 is visibly restless. */
  speed: 1,
  /** Emitter/maxcount territory in the engine (150 / 50); 140 reads as "ash". */
  density: 140,
  /** sizerandom.min 20 / max 350 scene units, mapped to CSS pixels. */
  particleSize: 2.2,
  /** alpharandom's default is 1; a wallpaper wants them fainter than that. */
  particleOpacity: 0.55,
  /** lifetimerandom.min 1 / max 5 seconds. */
  particleLife: 3.5,
  /** velocityrandom -200..200 and drift rise 120 / speed 200, in px/s. */
  particleSpeed: 40,
  /** drift.turbulence weight is 0.15 in the engine's drift model. */
  particleTurbulence: 0.35,
  /** colorrandom's default is white; empty means the theme, like the palette. */
  particleColor: '',
  /** Emitters point up (0 1 0 in the engine): 90 degrees is up here too. */
  particleWind: 90,
} as const;

/** The most particles the custom wallpaper will draw, whatever a setting says. */
export const CUSTOM_MAX_PARTICLES = 240;

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
  useAdminBackground: true,
  autoAccent: true,
  accentColor: '',
  customA: '',
  customB: '',
  customDrift: CUSTOM_DEFAULTS.drift,
  customSpeed: CUSTOM_DEFAULTS.speed,
  customDensity: CUSTOM_DEFAULTS.density,
  customParticleSize: CUSTOM_DEFAULTS.particleSize,
  customParticleOpacity: CUSTOM_DEFAULTS.particleOpacity,
  customParticleLife: CUSTOM_DEFAULTS.particleLife,
  customParticleSpeed: CUSTOM_DEFAULTS.particleSpeed,
  customParticleTurbulence: CUSTOM_DEFAULTS.particleTurbulence,
  customParticleColor: CUSTOM_DEFAULTS.particleColor,
  customParticleWind: CUSTOM_DEFAULTS.particleWind,
};

/** The two colours the custom wallpaper is drawn with. */
export interface WallpaperColors {
  a: string;
  b: string;
}

/**
 * The custom wallpaper's palette, as CSS the browser can resolve.
 *
 * Empty means the theme's own accents, and those are written as var() rather
 * than read here: the still backdrop is a plain <div>, so it can follow a theme
 * change without any JavaScript running.
 */
export function customColors(a: string, b: string): WallpaperColors {
  return {
    a: (a ?? '').trim() || 'var(--accent)',
    b: (b ?? '').trim() || 'var(--accent-2)',
  };
}

/**
 * The still version of the custom wallpaper.
 *
 * The layer shows this before the canvas exists, on the server (which has no
 * canvas at all), in jsdom, and anywhere a 2D context is unavailable. It is the
 * same three-layer picture the canvas paints, flattened into CSS - so "the
 * browser cannot animate it" costs the movement, not the look.
 */
export function customBackdrop(colors: WallpaperColors): string {
  return (
    `radial-gradient(120% 120% at 18% 12%, ${colors.a}, transparent 62%), ` +
    `radial-gradient(110% 110% at 82% 78%, ${colors.b}, transparent 66%), ` +
    `linear-gradient(140deg, ${colors.a}, ${colors.b})`
  );
}

/** The particle count for a density setting, clamped to what the canvas will draw. */
export function customParticleCount(density: number): number {
  return Math.round(clamp(Number(density), 0, CUSTOM_MAX_PARTICLES));
}

/**
 * The custom wallpaper settings a caller may hand over.
 *
 * Every field is optional: this is what an old settings file, an administrator's
 * background and the appearance dialog all provide, and none of them is required
 * to have thought about particles.
 */
export interface CustomWallpaperParams {
  customA?: string;
  customB?: string;
  customDrift?: number;
  customSpeed?: number;
  customDensity?: number;
  customParticleSize?: number;
  customParticleOpacity?: number;
  customParticleLife?: number;
  customParticleSpeed?: number;
  customParticleTurbulence?: number;
  customParticleColor?: string;
  customParticleWind?: number;
}

/** The custom wallpaper, filled in and clamped: what the layer actually draws. */
export interface ResolvedCustomWallpaper {
  colors: WallpaperColors;
  /** Amplitudes are fractions of the viewport, 0 - 1. */
  drift: number;
  speed: number;
  particles: {
    count: number;
    /** CSS pixels. */
    size: number;
    opacity: number;
    /** Seconds. */
    life: number;
    /** CSS pixels per second. */
    speed: number;
    turbulence: number;
    /** CSS colour; empty means the theme's accent. */
    color: string;
    /** Degrees: 90 is up, 0 is to the right. */
    wind: number;
  };
}

const between = (value: unknown, min: number, max: number, fallback: number): number =>
  clamp(Number(value ?? fallback), min, max);

/**
 * Fills a partial custom wallpaper out to the full set.
 *
 * One function, used by the layer, by both dialogs' previews and by the
 * administrator mapping, so a missing or out-of-range number is answered in
 * exactly one place.
 */
export function resolveCustomWallpaper(settings: CustomWallpaperParams): ResolvedCustomWallpaper {
  return {
    colors: customColors(settings.customA ?? '', settings.customB ?? ''),
    drift: between(settings.customDrift, 0, 1, CUSTOM_DEFAULTS.drift),
    speed: between(settings.customSpeed, 0.2, 2, CUSTOM_DEFAULTS.speed),
    particles: {
      count: customParticleCount(settings.customDensity ?? CUSTOM_DEFAULTS.density),
      size: between(settings.customParticleSize, 0.6, 6, CUSTOM_DEFAULTS.particleSize),
      opacity: between(settings.customParticleOpacity, 0.05, 1, CUSTOM_DEFAULTS.particleOpacity),
      life: between(settings.customParticleLife, 1, 12, CUSTOM_DEFAULTS.particleLife),
      speed: between(settings.customParticleSpeed, 0, 120, CUSTOM_DEFAULTS.particleSpeed),
      turbulence: between(settings.customParticleTurbulence, 0, 1, CUSTOM_DEFAULTS.particleTurbulence),
      color: (settings.customParticleColor ?? CUSTOM_DEFAULTS.particleColor).trim(),
      wind: between(settings.customParticleWind, 0, 360, CUSTOM_DEFAULTS.particleWind),
    },
  };
}

/** One slider the appearance and settings dialogs draw for the custom wallpaper. */
export interface CustomWallpaperControl {
  /** The WallpaperSettings/BackgroundSettings field it writes. */
  key: keyof CustomWallpaperParams;
  label: string;
  min: number;
  max: number;
  step: number;
  /** How the current value is shown at the right of the label. */
  format: (value: number) => string;
}

/**
 * The controls both dialogs render.
 *
 * One list rather than two copies of the same eight rows: the appearance dialog
 * and the administrator's dialog have to offer the same knobs, or a default
 * background cannot be described in the same terms as a personal one.
 */
export const CUSTOM_WALLPAPER_SLIDERS: readonly CustomWallpaperControl[] = [
  { key: 'customDrift', label: '晃动幅度', min: 0, max: 1, step: 0.02, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'customSpeed', label: '晃动速度', min: 0.2, max: 2, step: 0.05, format: (v) => `×${v.toFixed(2)}` },
  { key: 'customDensity', label: '粒子数量', min: 0, max: CUSTOM_MAX_PARTICLES, step: 5, format: (v) => String(Math.round(v)) },
  { key: 'customParticleSize', label: '粒子大小', min: 0.6, max: 6, step: 0.1, format: (v) => `${v.toFixed(1)}px` },
  { key: 'customParticleOpacity', label: '粒子不透明度', min: 0.05, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'customParticleLife', label: '粒子寿命', min: 1, max: 12, step: 0.5, format: (v) => `${v.toFixed(1)}s` },
  { key: 'customParticleSpeed', label: '粒子速度', min: 0, max: 120, step: 2, format: (v) => `${Math.round(v)} px/s` },
  { key: 'customParticleTurbulence', label: '湍流强度', min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` },
  { key: 'customParticleWind', label: '风向', min: 0, max: 360, step: 5, format: (v) => `${Math.round(v)}°` },
];

/**
 * A colour a canvas can paint with.
 *
 * A canvas cannot resolve CSS variables, so `var(--accent)` has to become the
 * value `--accent` currently holds. `read` is passed in rather than looked up
 * here: this stays a pure function, and the caller owns the one getComputedStyle
 * call of a frame.
 */
export function resolveCssColor(value: string, read: (name: string) => string, fallback: string): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return fallback;
  const variable = /^var\(\s*(--[A-Za-z0-9-]+)\s*\)$/.exec(trimmed);
  if (!variable) return trimmed;
  const found = read(variable[1]).trim();
  return found || fallback;
}

/* -------------------------------------------------------------------------- */
/* Imported pictures: shrink before storing                                   */
/* -------------------------------------------------------------------------- */

/**
 * How big an imported wallpaper is allowed to be.
 *
 * 2560 covers a 1440p screen at two device pixels per CSS pixel in the long
 * edge, which is the most a background can be seen at once. An untouched phone
 * photo is 4000-6000 px wide and weighs 3-12 MB; this turns it into a few
 * hundred KB, and that is the feature: the wallpaper is stored in this browser,
 * not uploaded anywhere, so its size is the user's disk.
 */
export const CUSTOM_IMAGE_MAX_EDGE = 2560;
/** WebP quality for the stored copy. 0.82 is where a photo stops showing it. */
export const CUSTOM_IMAGE_QUALITY = 0.82;

/** The size a picture is resized to so its longest edge fits `maxEdge`. Pure. */
export function shrinkDimensions(
  width: number,
  height: number,
  maxEdge: number = CUSTOM_IMAGE_MAX_EDGE,
): { width: number; height: number } {
  const w = Math.max(1, Math.round(Number(width) || 0));
  const h = Math.max(1, Math.round(Number(height) || 0));
  const edge = Math.max(1, Math.round(maxEdge));
  const scale = Math.min(1, edge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** What a picture became after shrinking. */
export interface ShrunkWallpaper {
  /** The bytes to store: the re-encoded copy, or the original when that was kept. */
  blob: Blob;
  /** A file name that matches the bytes actually produced. */
  fileName: string;
  /** Bytes before and after, for the message the user sees. */
  before: number;
  after: number;
  width: number;
  height: number;
  /** False when the original was passed through untouched. */
  shrunk: boolean;
}

/** A decodable picture, from either of the two browser decoding paths. */
async function decodePicture(
  file: Blob,
): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void } | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close?.(),
      };
    } catch {
      /* fall through to the <img> path */
    }
  }
  if (typeof document === 'undefined' || typeof Image === 'undefined' || typeof URL === 'undefined') return null;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () =>
      resolve({
        source: image,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
        release: () => URL.revokeObjectURL(url),
      });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    image.src = url;
  });
}

function encodeCanvas(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== 'function') {
      resolve(null);
      return;
    }
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch {
      resolve(null);
    }
  });
}

/** The original name with the extension of the format actually produced. */
function shrunkFileName(file: Blob, type: string): string {
  const named = typeof File !== 'undefined' && file instanceof File ? file.name : '';
  const base = named.replace(/\.[^.]+$/, '') || 'wallpaper';
  const extension = type === 'image/webp' ? 'webp' : type === 'image/jpeg' ? 'jpg' : 'png';
  return `${base}.${extension}`;
}

/**
 * Shrinks an imported picture before it is stored.
 *
 * The original is kept when it cannot be decoded here (SSR, jsdom, a browser
 * without canvas, a broken file): a wallpaper that cannot be animated is still
 * worth more than a wallpaper that silently vanished. Small already-optimised
 * pictures are kept too - re-encoding a 90 KB JPEG gains nothing and loses a
 * generation of quality.
 */
export async function shrinkWallpaperImage(
  file: Blob,
  options: { maxEdge?: number; quality?: number } = {},
): Promise<ShrunkWallpaper> {
  const maxEdge = options.maxEdge ?? CUSTOM_IMAGE_MAX_EDGE;
  const quality = options.quality ?? CUSTOM_IMAGE_QUALITY;
  const size = Number(file.size) || 0;
  const unchangedResult = (width: number, height: number): ShrunkWallpaper => ({
    blob: file,
    fileName: shrunkFileName(file, file.type || 'image/png'),
    before: size,
    after: size,
    width,
    height,
    shrunk: false,
  });

  const picture = await decodePicture(file);
  if (!picture) return unchangedResult(0, 0);
  const target = shrinkDimensions(picture.width, picture.height, maxEdge);
  const sameSize = target.width === picture.width && target.height === picture.height;
  // Only a tiny, already-optimised picture has nothing to gain - re-encoding it
  // would cost a generation of quality. Anything bigger still benefits: a
  // 1600px JPEG measured 274 KB and became 111 KB of WebP in the same browser.
  if (sameSize && size <= 128 * 1024 && /webp|jpe?g/i.test(file.type || '')) {
    picture.release();
    return unchangedResult(picture.width, picture.height);
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext('2d');
    if (!context) {
      picture.release();
      return unchangedResult(picture.width, picture.height);
    }
    context.drawImage(picture.source, 0, 0, target.width, target.height);
    const encoded = await encodeCanvas(canvas, 'image/webp', quality);
    picture.release();
    if (!encoded) return unchangedResult(target.width, target.height);
    return {
      blob: encoded,
      fileName: shrunkFileName(file, encoded.type),
      before: size,
      after: encoded.size,
      width: target.width,
      height: target.height,
      shrunk: true,
    };
  } catch {
    picture.release();
    return unchangedResult(target.width, target.height);
  }
}

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
      useAdminBackground: parsed.useAdminBackground !== false,
      autoAccent: parsed.autoAccent !== false,
      accentColor: typeof parsed.accentColor === 'string' ? parsed.accentColor : '',
      // Settings written before the custom wallpaper existed hold none of
      // these; the defaults are what it looked like the day it shipped. The
      // numbers are clamped here as well as in resolveCustomWallpaper, so what
      // is written back to storage is always inside the range the sliders offer.
      customA: typeof parsed.customA === 'string' ? parsed.customA : '',
      customB: typeof parsed.customB === 'string' ? parsed.customB : '',
      customDrift: between(parsed.customDrift, 0, 1, CUSTOM_DEFAULTS.drift),
      customSpeed: between(parsed.customSpeed, 0.2, 2, CUSTOM_DEFAULTS.speed),
      customDensity: customParticleCount(parsed.customDensity ?? CUSTOM_DEFAULTS.density),
      customParticleSize: between(parsed.customParticleSize, 0.6, 6, CUSTOM_DEFAULTS.particleSize),
      customParticleOpacity: between(parsed.customParticleOpacity, 0.05, 1, CUSTOM_DEFAULTS.particleOpacity),
      customParticleLife: between(parsed.customParticleLife, 1, 12, CUSTOM_DEFAULTS.particleLife),
      customParticleSpeed: between(parsed.customParticleSpeed, 0, 120, CUSTOM_DEFAULTS.particleSpeed),
      customParticleTurbulence: between(parsed.customParticleTurbulence, 0, 1, CUSTOM_DEFAULTS.particleTurbulence),
      customParticleColor: typeof parsed.customParticleColor === 'string' ? parsed.customParticleColor : '',
      customParticleWind: between(parsed.customParticleWind, 0, 360, CUSTOM_DEFAULTS.particleWind),
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
  if (kind === 'scene') return '.pkg';
  return 'image/*';
}

/** Extensions the browser can put on screen. */
export const WALLPAPER_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif', 'bmp', 'svg'];
export const WALLPAPER_VIDEO_EXTENSIONS = ['mp4', 'webm', 'm4v', 'mov', 'ogv'];

/** image, video, scene, or null when the file is not something we can show. */
export function wallpaperKindOf(name: string): 'image' | 'video' | 'scene' | null {
  // A .pkg is a scene wallpaper: the container the library reads. It used to be
  // reported as unshowable, which is why scenes could only arrive through the
  // folder scan rather than by picking the file.
  if (name.toLowerCase().endsWith('.pkg')) return 'scene';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (WALLPAPER_IMAGE_EXTENSIONS.includes(ext)) return 'image';
  if (WALLPAPER_VIDEO_EXTENSIONS.includes(ext)) return 'video';
  return null;
}
