/**
 * Runs a scene wallpaper live, through WebGL, in the worker.
 *
 * The canvas is handed to the worker with transferControlToOffscreen, so every
 * part of it - parsing the container, decoding textures, translating shaders,
 * drawing frames - happens off the main thread. That is what keeps the page
 * smooth while a wallpaper animates behind it.
 *
 * Costlier than the still, hence opt-in: it holds a GPU context and draws
 * continuously, which on a laptop means battery and heat.
 */

import { getSceneWorker, nextRequestId, send } from './worker';
import type { PlayRequest, PlayResponse } from './protocol';

export interface ScenePlayer {
  stop(): void;
  pause(): void;
  resume(): void;
  /** What the worker reported when the first frame went up. */
  info: { width: number; height: number; resolved: number; skipped: number };
  /** Frames drawn so far, and the error if the worker gave up. */
  status(): { frames: number; error?: string };
}

/** Everything the live path needs beyond the still path. */
export function canPlayScenes(): boolean {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return false;
  if (typeof HTMLCanvasElement === 'undefined') return false;
  return typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';
}

export interface PlayOptions {
  /** Cap on the render target. A background does not need native resolution. */
  maxWidth?: number;
  fps?: number;
  /**
   * Called when the worker gives up after the first frame. Without this the
   * canvas would simply freeze on its last frame and look like a still.
   */
  onError?: (message: string) => void;
}

export async function playScene(
  canvas: HTMLCanvasElement,
  pkgBytes: ArrayBuffer,
  options: PlayOptions = {},
): Promise<ScenePlayer> {
  const id = nextRequestId();
  const worker = getSceneWorker();

  let frames = 0;
  let error: string | undefined;
  let settled = false;
  let stopWatching = () => {};

  const first = new Promise<PlayResponse>((resolve) => {
    const onMessage = (event: MessageEvent<PlayResponse>) => {
      const reply = event.data;
      if (reply?.kind !== 'play' || reply.id !== id) return;
      if (!reply.ok) {
        error = reply.error ?? '场景渲染失败';
        if (!settled) {
          settled = true;
          resolve(reply);
        } else {
          options.onError?.(error);
        }
        stopWatching();
        return;
      }
      frames = reply.frames ?? frames;
      if (!settled) {
        settled = true;
        resolve(reply);
      }
    };
    worker.addEventListener('message', onMessage as EventListener);
    stopWatching = () => worker.removeEventListener('message', onMessage as EventListener);
  });

  // One canvas can only be handed over once, so the caller must keep it for the
  // lifetime of the player.
  const offscreen = canvas.transferControlToOffscreen();
  const request: PlayRequest = {
    kind: 'play',
    id,
    canvas: offscreen,
    bytes: pkgBytes,
    maxWidth: options.maxWidth ?? 1920,
    fps: options.fps ?? 30,
  };
  send(request, [offscreen, pkgBytes]);

  const response = await first;
  stopWatching();
  if (!response.ok) throw new Error(response.error ?? '场景渲染失败');

  return {
    info: {
      width: response.width ?? 0,
      height: response.height ?? 0,
      resolved: response.resolved ?? 0,
      skipped: response.skipped ?? 0,
    },
    status: () => ({ frames, error }),
    stop: () => send({ kind: 'stop', id }),
    pause: () => send({ kind: 'pause', id }),
    resume: () => send({ kind: 'resume', id }),
  };
}

export { disposeSceneWorker } from './worker';
