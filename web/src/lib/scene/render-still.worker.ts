/// <reference lib="webworker" />
/**
 * Renders one frame of a Wallpaper Engine scene and hands back a JPEG.
 *
 * This is the "static background" mode: no effect animation, no shader
 * translation, no GPU - just the layers composited at t=0. It runs here rather
 * than on the page because a 45 MB container with a few hundred texture decodes
 * takes seconds, and doing that on the main thread would freeze the UI.
 */

import { getEntry, parsePkg } from '../we-scene/pkg/container.js';
import { renderScene } from '../we-scene/render/cpu.js';
import { parseScene } from '../we-scene/scene/parse.js';
import { loadSceneAssets } from './load-browser';
import type { StillRequest, StillResponse } from './protocol';

self.onmessage = async (event: MessageEvent<StillRequest>) => {
  const { id, bytes, maxWidth, quality } = event.data;
  const reply = (message: Omit<StillResponse, 'id'>) => self.postMessage({ id, ...message } satisfies StillResponse);

  try {
    const pkg = parsePkg(new Uint8Array(bytes));

    const sceneEntry = getEntry(pkg, 'scene.json');
    if (!sceneEntry) throw new Error('scene.pkg 里没有 scene.json');
    const scene = parseScene(JSON.parse(new TextDecoder().decode(sceneEntry)), null);

    const projection = scene.general?.orthogonalprojection as { width?: number; height?: number } | undefined;
    const fullWidth = Math.round(Number(projection?.width) || 1920);
    const fullHeight = Math.round(Number(projection?.height) || 1080);
    const scale = Math.min(1, maxWidth / fullWidth);
    const width = Math.max(1, Math.round(fullWidth * scale));
    const height = Math.max(1, Math.round(fullHeight * scale));

    const { textures, resolved, skipped } = await loadSceneAssets(pkg, scene);
    const frame = renderScene(scene, textures, width, height, 0);

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.putImageData(new ImageData(new Uint8ClampedArray(frame.rgba), width, height), 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });

    reply({
      ok: true,
      blob,
      width,
      height,
      drawn: frame.drawn,
      resolved,
      skipped: skipped.length,
    });
  } catch (err) {
    reply({ ok: false, error: (err as Error).message || String(err) });
  }
};
