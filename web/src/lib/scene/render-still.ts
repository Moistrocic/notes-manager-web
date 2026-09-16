/**
 * One frame of a scene wallpaper, for the static background.
 *
 * The frame comes from the same renderer the live wallpaper uses - the library
 * exposes renderFrame(time) for exactly this - so a scene cannot look one way
 * as a still and another way once it animates. It used to be composited by a
 * second, CPU rasteriser, and the two disagreed about which textures resolved
 * and which layers to hide.
 */

import { createRossiWallpaper } from 'wallpaper-scene-layers';
import { idbGet, idbPut } from '../wallpaper';
import { releaseContext } from './play-scene';

export interface SceneStill {
  blob: Blob;
  width: number;
  height: number;
  /** Layers in the scene, after the preset's filter. */
  drawn: number;
  resolved: number;
  skipped: number;
}

/**
 * Bumped whenever the renderer's output changes. Without it a wallpaper keeps
 * showing the frame an older build produced, which is how white boxes survived
 * the fix that removed them.
 *
 * v4: drawn by wallpaper-scene-layers, with its particle simulation and text
 * rasterisation, rather than by the renderer whose unsupported layers were
 * painted as white rectangles.
 */
const RENDER_VERSION = 'v4';
const CACHE_PREFIX = `scene-still:${RENDER_VERSION}:`;

export function canRenderScenes(): boolean {
  return typeof document !== 'undefined' && typeof HTMLCanvasElement !== 'undefined';
}

export interface RenderOptions {
  /** Cache key: must change when the file does. */
  cacheKey: string;
  maxWidth?: number;
  quality?: number;
  /** Whether a remembered frame may be reused. */
  useCache?: boolean;
}

/**
 * A frame of a scene that is on the other end of a URL.
 *
 * The cache is checked before the download, so a wallpaper that has been seen
 * before costs one IndexedDB read rather than 45 MB off the wire - which is
 * the difference between an instant background and a pause on every page load.
 */
export async function renderSceneStillFrom(url: string, options: RenderOptions): Promise<SceneStill> {
  if (options.useCache !== false) {
    const remembered = await idbGet<SceneStill>(CACHE_PREFIX + options.cacheKey);
    if (remembered?.blob) return remembered;
  }
  const bytes = await (await fetch(url)).arrayBuffer();
  return renderSceneStill(bytes, { ...options, useCache: false });
}

/**
 * A picture of a scene, ready to put on screen.
 *
 * Used when a scene is not being played live: one frame is composited and the
 * result is a blob URL an img can show.
 */
export async function sceneStillUrl(url: string, cacheKey: string): Promise<string> {
  const still = await renderSceneStillFrom(url, { cacheKey });
  return URL.createObjectURL(still.blob);
}

export async function renderSceneStill(pkgBytes: ArrayBuffer, options: RenderOptions): Promise<SceneStill> {
  const key = CACHE_PREFIX + options.cacheKey;
  if (options.useCache !== false) {
    const cached = await idbGet<SceneStill>(key);
    if (cached?.blob) return cached;
  }

  const width = options.maxWidth ?? 2560;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.round((width * 9) / 16);

  const wallpaper = await createRossiWallpaper({
    canvas,
    source: pkgBytes,
    fit: 'cover',
    autoStart: false,
    trackMouse: false,
  });
  try {
    wallpaper.renderFrame(0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', options.quality ?? 0.92),
    );
    if (!blob) throw new Error('场景帧导出失败');

    const still: SceneStill = {
      blob,
      width: canvas.width,
      height: canvas.height,
      drawn: wallpaper.layers.length,
      resolved: wallpaper.layers.length,
      skipped: 0,
    };
    void idbPut(key, still);
    return still;
  } finally {
    wallpaper.dispose();
    // The canvas is finished with; its WebGL context is a browser wide resource
    // that would otherwise sit there until a garbage collection happened to
    // collect it, and the wallpaper's own context is the one that pays when
    // they run out.
    releaseContext(canvas);
  }
}