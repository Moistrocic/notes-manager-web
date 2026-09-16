/**
 * Runs a scene wallpaper live.
 *
 * All of it is wallpaper-scene-layers now. This file is the adapter that gives
 * the rest of the app a smaller surface than the library's - start, stop,
 * pause, and what was loaded - and it is where the rendering is put in a
 * worker: a scene parses a 45 MB container, decodes its textures and compiles
 * its shaders, and doing that on the main thread is what made switching
 * wallpapers look like the server had died.
 *
 * The library falls back to the main thread by itself when a browser has no
 * OffscreenCanvas, so there is one code path here either way.
 */

import { createRossiWorkerWallpaper, supportsWorkerRendering, type WorkerWallpaper } from 'wallpaper-scene-layers';
import type { WallpaperKind } from '../wallpaper';
// Vite bundles this: the library's own worker URL points next to its module,
// which a build has no way to copy into the app's assets.
import RenderWorker from 'wallpaper-scene-layers/worker?worker';

export interface ScenePlayer {
  /** What the first frame reported, for the dialog to mention. */
  info: { width: number; height: number; resolved: number; skipped: number };
  /** Whether the frames are drawn in a worker or on the main thread. */
  offscreen: boolean;
  stop(): void;
  pause(): void;
  resume(): void;
}

/**
 * The largest drawing buffer a live scene may ask the GPU for.
 *
 * The renderer sizes its buffer from the element, and the crop sizes the
 * element, so selecting a tenth of the picture asked for a hundred times the
 * pixels - every frame, plus render targets the same size again. Past the
 * screen's own resolution none of it is visible: those pixels are interpolated
 * from the ones the scene's own textures have. What it does buy is a driver
 * that runs out of memory and takes the context with it. Cap it, and let the
 * browser magnify what was drawn instead.
 */
/** What a caller sees when it gave up on a load before it finished. */
const ABORTED = '场景载入已取消';

const MAX_BUFFER_SIDE = 8192;
const MAX_BUFFER_PIXELS = 16_000_000;

function devicePixelRatio(): number {
  if (typeof window === 'undefined') return 1;
  return window.devicePixelRatio || 1;
}

/**
 * The ratio to hand the renderer: the screen's, unless that would ask for more
 * pixels than a wallpaper is worth.
 */
export function scenePixelRatio(canvas: HTMLCanvasElement): number {
  const ratio = devicePixelRatio();
  // The element is already the size the crop makes it, which is exactly what
  // the renderer would measure; the fallbacks are the library's own.
  const width = (canvas.clientWidth || canvas.width || 1920) * ratio;
  const height = (canvas.clientHeight || canvas.height || 1080) * ratio;
  const shrink = Math.max(1, Math.max(width, height) / MAX_BUFFER_SIDE, Math.sqrt((width * height) / MAX_BUFFER_PIXELS));
  return ratio / shrink;
}

/** Builds one context to find out, and gives it back before returning. */
export function probeSceneSupport(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') as WebGL2RenderingContext | null;
    releaseContext(probe, gl);
    return Boolean(gl);
  } catch {
    return false;
  }
}

/** The answer, remembered: a browser does not grow a WebGL2 out of nothing. */
let sceneSupport: boolean | null = null;

/**
 * Whether this browser can run a scene at all.
 *
 * A worker is enough on its own - the library renders there and falls back to
 * the main thread, which then needs WebGL2. The question is asked on every
 * render of the appearance dialog, which is every step of a crop drag, so the
 * answer is remembered; asking it used to allocate a WebGL context per call,
 * and the context a browser drops to make room for those is the wallpaper's
 * own.
 */
export function canPlayScenes(): boolean {
  if (sceneSupport === null) sceneSupport = supportsWorkerRendering() || probeSceneSupport();
  return sceneSupport;
}

/**
 * Whether a scene should be played live rather than shown as a picture of it.
 *
 * The switch is the whole answer where the browser can do it: deciding here,
 * on every render, is what makes turning the switch reload the background
 * instead of the wallpaper having to be picked again.
 */
export function playsScenesLive(kind: WallpaperKind, dynamic: boolean): boolean {
  return kind === 'scene' && dynamic && canPlayScenes();
}

/**
 * Gives a canvas's WebGL context back to the browser.
 *
 * A canvas nobody will draw on again holds its context until the garbage
 * collector happens to run, and there are only a handful to go round. The
 * thumbnail canvases are used once, so this is what keeps a run of still
 * renders from evicting the context of the wallpaper that is on screen.
 *
 * Only ever for canvases that are finished with: a lost context cannot be
 * replaced, so this is not something to do to the layer's own canvas.
 */
export function releaseContext(canvas: HTMLCanvasElement, known?: WebGL2RenderingContext | null): void {
  try {
    const gl = known === undefined ? (canvas.getContext('webgl2') as WebGL2RenderingContext | null) : known;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    /* no context to give back */
  }
}

export interface PlayOptions {
  /**
   * Gives up on a load nobody is waiting for any more.
   *
   * Switching wallpapers used to leave the previous container downloading,
   * parsing and decoding in the background - two 45 MB scenes at once is what
   * made the page look like it had hung. Aborting stops that worker there and
   * then.
   */
  signal?: AbortSignal;
  /**
   * Called when something goes wrong that stops the scene.
   *
   * Not the same as a diagnostic, which is the library saying it could not do
   * part of the job and carried on - an effect whose shader it cannot compile,
   * say. Those are reported once and do not stop anything; routing them here
   * stopped the wallpaper and filled the screen with identical toasts.
   */
  onError?: (message: string) => void;
  /** Something the library could not do, having worked around it. */
  onDiagnostic?: (message: string) => void;
}

/**
 * @param source Where the scene.pkg is: a URL the worker downloads itself.
 *   Handing over bytes instead would copy 45 MB on the main thread first.
 */
export async function playScene(
  canvas: HTMLCanvasElement,
  source: string,
  options: PlayOptions = {},
): Promise<ScenePlayer> {
  const signal = options.signal;
  if (signal?.aborted) throw new Error(ABORTED);

  // The worker is kept in hand so that giving up can stop it: the library's
  // own promise only settles when the worker says it is ready, and a worker
  // that never gets there would load a scene nobody asked for any more.
  let worker: Worker | null = null;
  const stopWorker = () => {
    try {
      worker?.terminate();
    } catch {
      /* already gone */
    }
  };
  const aborted = new Promise<never>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new Error(ABORTED)), { once: true });
  });

  let wallpaper: WorkerWallpaper;
  try {
    wallpaper = await Promise.race([
      createRossiWorkerWallpaper({
        canvas,
        source,
        fit: 'cover',
        autoStart: true,
        trackMouse: false,
        pixelRatio: scenePixelRatio(canvas),
        worker: () => (worker = new RenderWorker({ name: 'we-scene-renderer' })),
        onDiagnostic: (message: string) => options.onDiagnostic?.(message),
      }),
      aborted,
    ]);
  } catch (err) {
    stopWorker();
    throw err;
  }
  if (signal?.aborted) {
    wallpaper.dispose();
    throw new Error(ABORTED);
  }

  return {
    info: {
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      resolved: wallpaper.layers.length,
      skipped: 0,
    },
    offscreen: wallpaper.offscreen,
    // dispose rather than stop: a canvas can only be handed to a worker once,
    // so the element goes with the player - the layer keys it on what it is
    // showing, and mounts a new one for the next player.
    stop: () => wallpaper.dispose(),
    pause: () => wallpaper.stop(),
    resume: () => wallpaper.start(),
  };
}