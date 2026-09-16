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

/** The browser can do this here and now? */
export function canPlayScenes(): boolean {
  if (typeof document === 'undefined' || typeof HTMLCanvasElement === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    return Boolean(probe.getContext('webgl2'));
  } catch {
    return false;
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
