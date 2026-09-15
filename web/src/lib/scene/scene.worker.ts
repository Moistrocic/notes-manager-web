/// <reference lib="webworker" />
/**
 * Composes Wallpaper Engine scenes, off the main thread.
 *
 * Two modes, one parser:
 *
 *  - "still": rasterise a single frame on the CPU and hand back a JPEG. This is
 *    the default, because it costs nothing to keep on screen.
 *  - "play": run the scene live through WebGL on an OffscreenCanvas the page
 *    transferred. Costlier, so the page only asks for it when the user turned
 *    dynamic scenes on.
 *
 * Both are here because both have to parse a container that can be 45 MB and
 * decode hundreds of textures; doing either on the main thread would freeze the
 * page for seconds.
 */

import { getEntry, parsePkg, type Pkg } from '../we-scene/pkg/container.js';
import { renderScene } from '../we-scene/render/cpu.js';
import { parseScene, type Scene } from '../we-scene/scene/parse.js';
import { loadSceneAssets } from './load-browser';
import type { PlayRequest, SceneRequest, SceneResponse, StillRequest } from './protocol';

interface Loop {
  id: number;
  stop: boolean;
  paused: boolean;
}

let current: Loop | null = null;

function post(message: SceneResponse): void {
  self.postMessage(message);
}

/** Reads the scene and its asset table out of a container. */
async function openScene(pkg: Pkg): Promise<{
  scene: Scene;
  textures: Awaited<ReturnType<typeof loadSceneAssets>>['textures'];
  resolved: number;
  skipped: number;
  width: number;
  height: number;
}> {
  const sceneEntry = getEntry(pkg, 'scene.json');
  if (!sceneEntry) throw new Error('scene.pkg 里没有 scene.json');
  const scene = parseScene(JSON.parse(new TextDecoder().decode(sceneEntry)), null);

  const projection = scene.general?.orthogonalprojection as { width?: number; height?: number } | undefined;
  const { textures, resolved, skipped } = await loadSceneAssets(pkg, scene);
  return {
    scene,
    textures,
    resolved,
    skipped: skipped.length,
    width: Math.round(Number(projection?.width) || 1920),
    height: Math.round(Number(projection?.height) || 1080),
  };
}

async function renderStill(request: StillRequest): Promise<void> {
  const { id, bytes, maxWidth, quality } = request;
  try {
    const pkg = parsePkg(new Uint8Array(bytes));
    const { scene, textures, resolved, skipped, width: fullWidth, height: fullHeight } = await openScene(pkg);

    const scale = Math.min(1, maxWidth / fullWidth);
    const width = Math.max(1, Math.round(fullWidth * scale));
    const height = Math.max(1, Math.round(fullHeight * scale));

    const frame = renderScene(scene, textures, width, height, 0);

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), width, height), 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });

    post({ kind: 'still', id, ok: true, blob, width, height, drawn: frame.drawn, resolved, skipped });
  } catch (err) {
    post({ kind: 'still', id, ok: false, error: (err as Error).message || String(err) });
  }
}

async function playScene(request: PlayRequest): Promise<void> {
  const { id, canvas, bytes, maxWidth, fps } = request;

  // Only one scene runs at a time; a second request replaces the first.
  if (current) current.stop = true;
  const loop: Loop = { id, stop: false, paused: false };
  current = loop;

  try {
    const pkg = parsePkg(new Uint8Array(bytes));
    const { scene, textures, resolved, skipped, width: fullWidth, height: fullHeight } = await openScene(pkg);
    if (loop.stop) return;

    const scale = Math.min(1, maxWidth / fullWidth);
    const width = Math.max(1, Math.round(fullWidth * scale));
    const height = Math.max(1, Math.round(fullHeight * scale));
    canvas.width = width;
    canvas.height = height;

    // Loaded on demand: this is the only thing that pulls in the WebGL renderer
    // and the HLSL translator, so nobody pays for them unless they ask.
    const { createRenderer, makeTexture } = await import('../we-scene/render/renderer.js');
    if (loop.stop) return;

    const renderer = createRenderer(canvas, {
      shaderResolver: async (relative: string) => {
        const entry = getEntry(pkg, relative);
        return entry ? new TextDecoder().decode(entry) : '';
      },
    });

    // The renderer samples texture objects that already carry a GL texture.
    for (const texture of textures.values()) {
      if (texture.video || !texture.rgba) continue;
      texture.glTex = makeTexture(renderer.gl, texture.rgba, texture.width, texture.height);
    }

    const frameBudget = 1000 / Math.max(1, Math.min(60, fps));
    const started = performance.now();
    let frames = 0;
    let lastPost = started;

    const tick = async () => {
      if (loop.stop) return;
      if (loop.paused) {
        // Keep the last frame on screen and stop drawing entirely.
        setTimeout(() => void tick(), 250);
        return;
      }
      const frameStart = performance.now();
      try {
        await renderer.render(scene, textures, width, height, (frameStart - started) / 1000);
      } catch (err) {
        loop.stop = true;
        post({ kind: 'play', id, ok: false, error: (err as Error).message || String(err) });
        return;
      }
      frames += 1;
      if (frameStart - lastPost > 4000) {
        lastPost = frameStart;
        post({ kind: 'play', id, ok: true, frames, width, height, resolved, skipped });
      }
      if (loop.stop) return;
      // Timer rather than requestAnimationFrame: workers have no rAF, and a
      // background does not need to be locked to the display's refresh.
      const spent = performance.now() - frameStart;
      setTimeout(() => void tick(), Math.max(0, frameBudget - spent));
    };

    post({ kind: 'play', id, ok: true, frames: 0, width, height, resolved, skipped });
    void tick();
  } catch (err) {
    post({ kind: 'play', id, ok: false, error: (err as Error).message || String(err) });
  }
}

self.onmessage = (event: MessageEvent<SceneRequest>) => {
  const request = event.data;
  if (request.kind === 'still') {
    void renderStill(request);
    return;
  }
  if (request.kind === 'play') {
    void playScene(request);
    return;
  }
  // stop / pause / resume all address the running loop; the id is only echoed.
  if (!current) return;
  if (request.kind === 'stop') {
    current.stop = true;
    current = null;
  } else if (request.kind === 'pause') {
    current.paused = true;
  } else {
    current.paused = false;
  }
};
