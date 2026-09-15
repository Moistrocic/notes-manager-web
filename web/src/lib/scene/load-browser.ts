/**
 * Scene asset loading, ported from we-scene's scene/load.js.
 *
 * The original decodes embedded PNG/JPEG through Node (zlib and Buffer) and
 * expects JPEG textures to have been pre-converted into PNG files on disk. In a
 * browser both come free through createImageBitmap, so this version is async,
 * needs no side files, and resolves strictly more textures than the Node path.
 *
 * It runs inside a worker: a 45 MB container plus a few hundred texture decodes
 * would otherwise lock up the page for seconds.
 */

import { getEntry } from '../we-scene/src/pkg/container.js';
import { decodeMip0, decodeMips, FIF, parseTex } from '../we-scene/src/pkg/texture.js';
import { generateNoiseTexture } from '../we-scene/src/render/noise.js';
import { resolveMaterial } from '../we-scene/src/scene/parse.js';
import type { Pkg, Scene, Texture } from './we-types';

const WHITE: Texture = { width: 1, height: 1, rgba: new Uint8Array([255, 255, 255, 255]) };
/** WE util/noflow: a neutral flow map, 127/255 ≈ 0.498, meaning "no displacement". */
const NOFLOW: Texture = { width: 1, height: 1, rgba: new Uint8Array([127, 127, 127, 255]) };

const MIME: Record<number, string> = {
  [FIF.JPEG]: 'image/jpeg',
  [FIF.PNG]: 'image/png',
  [FIF.GIF]: 'image/gif',
  [FIF.WEBP]: 'image/webp',
};

/** Decodes an image the container embedded, using the browser's own codecs. */
async function imageToRgba(bytes: Uint8Array, mime: string): Promise<{ width: number; height: number; rgba: Uint8Array }> {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0);
    const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    return { width: bitmap.width, height: bitmap.height, rgba: new Uint8Array(data.buffer) };
  } finally {
    bitmap.close();
  }
}

async function decodeTexture(pkg: Pkg, name: string): Promise<Texture | null> {
  // Materials normally reference "foo", stored as "materials/foo.tex"; a few
  // reference the full path, so both are tried.
  const entry = getEntry(pkg, 'materials/' + name + '.tex') ?? getEntry(pkg, name);
  if (!entry) return null;

  const tex = parseTex(entry);
  const mip = decodeMip0(tex);

  if ('video' in mip) return { width: mip.width, height: mip.height, rgba: null, video: true };
  if ('png' in mip) return { ...(await imageToRgba(mip.png, 'image/png')), rg88: tex.format === 8 };
  if ('image' in mip) {
    return { ...(await imageToRgba(mip.image, MIME[mip.fif] ?? 'image/png')), rg88: tex.format === 8 };
  }

  const mips = decodeMips(tex) as { width: number; height: number; rgba?: Uint8Array }[];
  const first = mips[0];
  if (!first?.rgba) return null;
  return {
    width: first.width,
    height: first.height,
    rgba: first.rgba,
    mips: mips
      .filter((m): m is { width: number; height: number; rgba: Uint8Array } => Boolean(m.rgba))
      .map((m) => ({ width: m.width, height: m.height, rgba: m.rgba })),
    rg88: tex.format === 8,
  };
}

export interface LoadedAssets {
  textures: Map<string, Texture>;
  /** Layers that found their texture. */
  resolved: number;
  /** Textures or layers that could not be decoded, for the report. */
  skipped: string[];
}

export async function loadSceneAssets(pkg: Pkg, scene: Scene): Promise<LoadedAssets> {
  const textures = new Map<string, Texture>();
  textures.set('util/white', WHITE);
  textures.set('util/noflow', NOFLOW);
  textures.set('util/noise', { width: 256, height: 256, rgba: generateNoiseTexture() });

  const skipped: string[] = [];
  let resolved = 0;
  const utf8 = new TextDecoder();

  const load = async (name: string): Promise<Texture | null> => {
    const cached = textures.get(name);
    if (cached) return cached;
    try {
      const texture = await decodeTexture(pkg, name);
      if (!texture) {
        skipped.push(name);
        return null;
      }
      textures.set(name, texture);
      return texture;
    } catch (err) {
      skipped.push(name + ': ' + (err as Error).message);
      return null;
    }
  };

  for (const layer of scene.layers) {
    if (layer.solid) {
      // Solid layers are Wallpaper Engine's own widgets - the clock, the audio
      // info card, album art, buttons - or plain colour fills. The rasteriser
      // paints every one of them 1x1 white, which shows up as white rectangles
      // over the picture, and their colour is not in the container anyway. WE's
      // components are on we-scene's unsupported list, so they are hidden.
      layer.visible = false;
      continue;
    }
    if (!layer.image) continue;
    try {
      const modelEntry = getEntry(pkg, layer.image);
      if (!modelEntry) continue; // a built-in model (util/solidlayer and friends)
      const model = JSON.parse(utf8.decode(modelEntry).replace(/^\uFEFF/, ''));
      const material = resolveMaterial(model);
      if (!material) continue;

      const materialEntry = getEntry(pkg, material.materialPath);
      if (!materialEntry) {
        skipped.push(layer.name + ': material ' + material.materialPath + ' missing');
        layer.visible = false;
        continue;
      }
      const parsed = JSON.parse(utf8.decode(materialEntry).replace(/^\uFEFF/, '')) as {
        passes?: { textures?: string[] }[];
      };
      const texName = parsed.passes?.[0]?.textures?.[0];
      if (texName && (await load(texName))) {
        layer.textureName = texName;
        resolved += 1;
      } else {
        // The rasteriser falls back to a 1x1 white texture for a layer with no
        // texture, which paints a solid white rectangle. In Wallpaper Engine an
        // empty layer is transparent, so hide it instead of drawing a box.
        layer.visible = false;
      }

      // Textures the effects need: shake flow maps, water masks, pulse noise.
      for (const effect of layer.effects ?? []) {
        for (const pass of effect.passes ?? []) {
          for (const name of pass.textures ?? []) {
            if (typeof name !== 'string' || name === '' || name.startsWith('util/') || name.startsWith('_rt_')) continue;
            await load(name);
          }
        }
      }
    } catch (err) {
      skipped.push(layer.name + ': ' + (err as Error).message);
    }
  }

  return { textures, resolved, skipped };
}
