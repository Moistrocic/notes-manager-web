/**
 * Composites a scene wallpaper into a still and remembers it.
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

const CACHE_PREFIX = 'scene-still:';

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
}

export async function renderSceneStill(pkgBytes: ArrayBuffer, options: RenderOptions): Promise<SceneStill> {
  const key = CACHE_PREFIX + options.cacheKey;
  const cached = await idbGet<SceneStill>(key);
  if (cached?.blob) return cached;

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
