/**
 * Gets one frame of a scene wallpaper and remembers it.
 *
 * The frame comes from the same WebGL renderer the live wallpaper uses - see
 * scene.worker.ts. It used to come from a second, CPU rasteriser, and the two
 * disagreed about which textures resolved and which layers to hide, so a scene
 * could look one way as a still and another way once it was animated.
 *
 * This is the default: one frame, cached, no ongoing cost. The live version
 * lives in play-scene.ts.
 */

import { idbGet, idbPut } from '../wallpaper';
import type { StillRequest, StillResponse } from './protocol';
import { awaitReply, getSceneWorker, nextRequestId } from './worker';

export interface SceneStill {
  blob: Blob;
  width: number;
  height: number;
  drawn: number;
  resolved: number;
  skipped: number;
}

/**
 * Bumped whenever the renderer's output changes - the layer loader, the
 * rasteriser, the vendored code. Without it a wallpaper keeps showing the frame
 * an older build produced, which is how white boxes survived the fix that
 * removed them.
 *
 * It has to be bumped for every change that alters what a scene looks like,
 * including the ones that only remove something. v3: the still comes from the
 * WebGL renderer rather than the CPU rasteriser, and the layers Wallpaper
 * Engine would have hidden at run time are hidden.
 */
const RENDER_VERSION = 'v3';
const CACHE_PREFIX = `scene-still:${RENDER_VERSION}:`;

/** The browser can do this here and now? */
export function canRenderScenes(): boolean {
  return (
    typeof Worker !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof createImageBitmap === 'function'
  );
}

export interface RenderOptions {
  /** Cache key: must change when the file does. */
  cacheKey: string;
  maxWidth?: number;
  quality?: number;
  /**
   * Whether a remembered frame may be reused.
   *
   * On in the app, where the same wallpaper is drawn over and over. Off in the
   * test bench, where the whole point is to see what the current code produces
   * - and where a cache hit is indistinguishable from a fix that did nothing.
   */
  useCache?: boolean;
}

export async function renderSceneStill(pkgBytes: ArrayBuffer, options: RenderOptions): Promise<SceneStill> {
  const key = CACHE_PREFIX + options.cacheKey;
  if (options.useCache !== false) {
    const cached = await idbGet<SceneStill>(key);
    if (cached?.blob) return cached;
  }

  const id = nextRequestId();
  const worker = getSceneWorker();
  const reply = awaitReply<StillResponse>(id, worker);

  const request: StillRequest = {
    kind: 'still',
    id,
    bytes: pkgBytes,
    maxWidth: options.maxWidth ?? 2560,
    quality: options.quality ?? 0.92,
  };
  // The buffer is transferred, so the caller's copy is gone afterwards.
  worker.postMessage(request, [pkgBytes]);

  const response = await reply;
  if (!response.ok || !response.blob) throw new Error(response.error ?? '场景渲染失败');

  const still: SceneStill = {
    blob: response.blob,
    width: response.width ?? 0,
    height: response.height ?? 0,
    drawn: response.drawn ?? 0,
    resolved: response.resolved ?? 0,
    skipped: response.skipped ?? 0,
  };
  void idbPut(key, still);
  return still;
}
