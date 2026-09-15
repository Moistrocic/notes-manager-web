/**
 * Renders a scene wallpaper into a still, off the main thread, and remembers it.
 *
 * The result is cached in IndexedDB, so switching back to a wallpaper is
 * instant and nothing is recomputed unless the file itself changed.
 */

import { idbGet, idbPut } from '../wallpaper';
import type { StillRequest, StillResponse } from './protocol';

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

let worker: Worker | null = null;
let nextId = 1;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./render-still.worker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

/** Drops the worker; used when the page is going away. */
export function disposeSceneRenderer(): void {
  worker?.terminate();
  worker = null;
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

  const id = nextId++;
  const target = getWorker();
  const response = await new Promise<StillResponse>((resolve, reject) => {
    const onMessage = (event: MessageEvent<StillResponse>) => {
      if (event.data?.id !== id) return;
      target.removeEventListener('message', onMessage);
      target.removeEventListener('error', onError);
      resolve(event.data);
    };
    const onError = (event: ErrorEvent) => {
      target.removeEventListener('message', onMessage);
      target.removeEventListener('error', onError);
      reject(new Error(event.message || '场景渲染线程出错'));
    };
    target.addEventListener('message', onMessage);
    target.addEventListener('error', onError);

    const request: StillRequest = {
      id,
      bytes: pkgBytes,
      maxWidth: options.maxWidth ?? 2560,
      quality: options.quality ?? 0.92,
    };
    // The buffer is transferred, so the caller's copy is gone afterwards.
    target.postMessage(request, [pkgBytes]);
  });

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
