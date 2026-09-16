/**
 * Runs a scene wallpaper live.
 *
 * All of it is wallpaper-scene-layers now: it parses the container, decodes the
 * textures, compiles the shaders, simulates the particles and draws. This file
 * is the adapter that gives the rest of the app a smaller surface than the
 * library's - start, stop, pause, and what was loaded.
 *
 * The renderer takes an HTMLCanvasElement and draws on the main thread, so
 * there is no worker and nothing is transferred. That costs some main-thread
 * time while a scene loads, and it buys a canvas that can be read back - which
 * is how the test bench can tell a moving scene from a frozen one.
 */

import { createRossiWallpaper, type Wallpaper } from 'wallpaper-scene-layers';

export interface ScenePlayer {
  /** What the first frame reported, for the dialog to mention. */
  info: { width: number; height: number; resolved: number; skipped: number };
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
 * The question is asked on every render of the appearance dialog, which is
 * every step of a crop drag - and the probe used to allocate a WebGL context
 * each time it was asked. A browser keeps only a handful of live contexts and
 * drops the oldest to make room, so a drag ended with the wallpaper's own
 * context evicted: the scene stopped rendering, and nothing but a new canvas
 * could bring it back, because a canvas whose context has been lost is never
 * given another one. Ask once, and hand the probe's context straight back.
 */
export function canPlayScenes(): boolean {
  if (sceneSupport === null) sceneSupport = probeSceneSupport();
  return sceneSupport;
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
  maxWidth?: number;
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

export async function playScene(
  canvas: HTMLCanvasElement,
  pkgBytes: ArrayBuffer,
  options: PlayOptions = {},
): Promise<ScenePlayer> {
  const wallpaper: Wallpaper = await createRossiWallpaper({
    canvas,
    source: pkgBytes,
    fit: 'cover',
    autoStart: true,
    trackMouse: false,
    pixelRatio: scenePixelRatio(canvas),
    onDiagnostic: (message: string) => options.onDiagnostic?.(message),
  });

  return {
    info: {
      width: canvas.width,
      height: canvas.height,
      resolved: wallpaper.layers.length,
      skipped: 0,
    },
    // dispose rather than stop: the canvas keeps whatever was last drawn, and
    // the next request builds its own renderer.
    stop: () => wallpaper.dispose(),
    pause: () => wallpaper.stop(),
    resume: () => wallpaper.start(),
  };
}