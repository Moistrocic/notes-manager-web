/// <reference lib="webworker" />
/**
 * Composes Wallpaper Engine scenes, off the main thread.
 *
 * Two modes, one renderer:
 *
 *  - "still": draw through WebGL into a canvas the worker owns, then hand the
 *    frame back as a JPEG. This is the default, because it costs nothing to
 *    keep on screen.
 *  - "play": keep drawing, on an OffscreenCanvas the page transferred. Costlier,
 *    so the page only asks for it when the user turned dynamic scenes on.
 *
 * The still used to be rasterised on the CPU by a second implementation, and
 * the two disagreed: different textures resolved, different layers hidden,
 * different white boxes. Whatever the live renderer produces is by definition
 * what the live wallpaper shows, so the still is now its first frame.
 *
 * Both are here because both have to parse a container that can be 45 MB and
 * decode hundreds of textures; doing either on the main thread would freeze the
 * page for seconds.
 */

import { getEntry, parsePkg } from '../we-scene/src/pkg/container.js';
import { parseScene } from '../we-scene/src/scene/parse.js';
import { loadSceneAssets } from './load-browser';
import type { PlayRequest, SceneRequest, SceneResponse, StillRequest } from './protocol';
import type { Pkg, Scene } from './we-types';

interface Loop {
  id: number;
  stop: boolean;
  paused: boolean;
}

/**
 * A cheap fingerprint of what was just drawn.
 *
 * Read from the framebuffer with gl.readPixels rather than through the page:
 * drawing a transferred canvas into a 2D one hands back the snapshot from the
 * moment it was transferred, so the page cannot tell a moving scene from a
 * still one. The renderer can.
 */
function fingerprint(gl: WebGL2RenderingContext, width: number, height: number): string {
  // The whole frame, not a patch of it. A window onto the middle reports "no
  // change" for a scene whose motion is in the corners, which is a false
  // negative that reads exactly like the bug being looked for.
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  // Strided: a sampled hash is as good at telling two frames apart as a
  // complete one, and walking 8 MB a second for no reason is not free.
  let hash = 2166136261;
  for (let i = 0; i < pixels.length; i += 401) {
    hash ^= pixels[i];
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
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

/**
 * Opens a container and gets a renderer ready on the given canvas.
 *
 * Shared by both modes so they cannot drift apart again, which is exactly what
 * went wrong when the still had a rasteriser of its own.
 */
async function openRenderer(pkg: Pkg, canvas: OffscreenCanvas, maxWidth: number) {
  const opened = await openScene(pkg);
  const scale = Math.min(1, maxWidth / opened.width);
  const width = Math.max(1, Math.round(opened.width * scale));
  const height = Math.max(1, Math.round(opened.height * scale));
  canvas.width = width;
  canvas.height = height;

  // Loaded on demand: this is the only thing that pulls in the WebGL renderer
  // and the HLSL translator, so nobody pays for them unless they ask.
  const { createRenderer, makeTexture } = await import('../we-scene/src/render/renderer.js');
  const renderer = createRenderer(canvas, {
    shaderResolver: async (relative: string) => {
      const entry = getEntry(pkg, relative);
      return entry ? new TextDecoder().decode(entry) : '';
    },
  });

  // The renderer samples texture objects that already carry a GL texture.
  for (const texture of opened.textures.values()) {
    if (texture.video || !texture.rgba) continue;
    texture.glTex = makeTexture(renderer.gl, texture.rgba, texture.width, texture.height);
  }

  return { ...opened, renderer, width, height };
}

async function renderStill(request: StillRequest): Promise<void> {
  const { id, bytes, maxWidth, quality } = request;
  try {
    const pkg = parsePkg(new Uint8Array(bytes));
    const canvas = new OffscreenCanvas(1, 1);
    const { renderer, scene, textures, resolved, skipped, width, height } = await openRenderer(pkg, canvas, maxWidth);

    // Two frames rather than one: the first can land before an effect has
    // anything to sample, and the second costs nothing.
    await renderer.render(scene, textures, width, height, 0);
    await renderer.render(scene, textures, width, height, 1 / 30);

    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    const drawn = scene.layers.filter((layer) => layer.visible).length;
    post({ kind: 'still', id, ok: true, blob, width, height, drawn, resolved, skipped });
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
    const { renderer, scene, textures, resolved, skipped, width, height } = await openRenderer(pkg, canvas, maxWidth);
    if (loop.stop) return;

    const frameBudget = 1000 / Math.max(1, Math.min(60, fps));
    const started = performance.now();
    let frames = 0;
    let lastPost = started;
    let painted = 0;
    let lastPrint = '';

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

      // Once a second at most: readPixels stalls the pipeline, and the question
      // it answers does not need asking sixty times a second.
      if (frameStart - lastPost > 1000) {
        const print = fingerprint(renderer.gl, width, height);
        if (lastPrint && print !== lastPrint) painted += 1;
        lastPrint = print;
      }
      if (frameStart - lastPost > 4000) {
        lastPost = frameStart;
        post({ kind: 'play', id, ok: true, frames, width, height, resolved, skipped, painted });
      }
      if (loop.stop) return;
      // Timer rather than requestAnimationFrame: workers have no rAF, and a
      // background does not need to be locked to the display's refresh.
      const spent = performance.now() - frameStart;
      setTimeout(() => void tick(), Math.max(0, frameBudget - spent));
    };

    post({ kind: 'play', id, ok: true, frames: 0, width, height, resolved, skipped, painted: 0 });
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
