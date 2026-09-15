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
  /**
   * Every layer that was hidden, and why.
   *
   * Kept because "a white rectangle is in the picture" is otherwise a guessing
   * game: the layer responsible is by definition one that is not being drawn,
   * so the only way to find it is to be told which ones were dropped and on
   * what grounds. The test bench prints this.
   */
  hidden: { index: number; name: string; reason: string }[];
  /** Layers left visible, with the texture each one will be drawn with. */
  drawn: { index: number; name: string; texture: string | null; average: string | null }[];
}

/**
 * Whether a texture is one flat colour from corner to corner.
 *
 * Wallpaper Engine uses these for whatever it paints at runtime: the bars of an
 * audio visualiser, slider tracks, the plate behind the music card. The colour
 * in the container is a placeholder that the real one replaces at run time, so
 * what gets drawn here is an opaque block of that placeholder - a white
 * rectangle over the picture, the same failure as a solid layer, and it gets
 * the same treatment.
 *
 * Sampled rather than averaged: an average cannot tell a flat grey from a
 * photograph of a grey wall.
 */
function isUniform(texture: Texture): boolean {
  const data = texture.rgba;
  if (!data || data.length < 8) return true;
  const step = Math.max(4, Math.floor(data.length / 4 / 64) * 4);
  const [r, g, b] = [data[0], data[1], data[2]];
  for (let i = 4; i < data.length - 3; i += step) {
    if (data[i] !== r || data[i + 1] !== g || data[i + 2] !== b) return false;
  }
  return true;
}

/** The mean colour of a texture, as #rrggbb - enough to spot a blank one. */
function averageColour(texture: Texture): string | null {
  if (!texture.rgba || texture.rgba.length < 4) return null;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  // Every 97th pixel: a faithful average without walking a 4K texture.
  for (let i = 0; i < texture.rgba.length - 3; i += 4 * 97) {
    r += texture.rgba[i];
    g += texture.rgba[i + 1];
    b += texture.rgba[i + 2];
    n += 1;
  }
  if (n === 0) return null;
  const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export async function loadSceneAssets(pkg: Pkg, scene: Scene): Promise<LoadedAssets> {
  const textures = new Map<string, Texture>();
  textures.set('util/white', WHITE);
  textures.set('util/noflow', NOFLOW);
  textures.set('util/noise', { width: 256, height: 256, rgba: generateNoiseTexture() });

  const skipped: string[] = [];
  const hidden: LoadedAssets['hidden'] = [];
  const drawn: LoadedAssets['drawn'] = [];
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

  for (const [index, layer] of scene.layers.entries()) {
    /** Records the decision, so the bench can say what happened to every layer. */
    const hide = (reason: string) => {
      layer.visible = false;
      hidden.push({ index, name: String(layer.name ?? ''), reason });
    };
    if (layer.solid) {
      // Solid layers are Wallpaper Engine's own widgets - the clock, the audio
      // info card, album art, buttons - or plain colour fills. The rasteriser
      // paints every one of them 1x1 white, which shows up as white rectangles
      // over the picture, and their colour is not in the container anyway. WE's
      // components are on we-scene's unsupported list, so they are hidden.
      // In Wallpaper Engine an empty layer is transparent; the rasteriser
      // paints it white instead, and that is the whole of the box problem.
      hide('solid 图层（WE 组件或纯色填充）');
      continue;
    }
    if (!layer.image) {
      // Nothing to draw from. Wallpaper Engine leaves such a layer transparent;
      // the rasteriser paints it 1x1 white, which is where the clock digits and
      // the audio card's labels were becoming white blocks. Same reasoning as
      // every other branch here: if no texture can be supplied, do not draw it.
      hide('没有 image，容器里没有可绘制的内容');
      continue;
    }
    try {
      const modelEntry = getEntry(pkg, layer.image);
      if (!modelEntry) {
        // A built-in model - util/solidlayer and friends. They are flat colour
        // fills whose colour lives outside the container, so they can only be
        // guessed at, and guessing white is what put rectangles on the picture.
        hide('内置模型（util/solidlayer 之类），颜色不在容器里');
        continue;
      }
      const model = JSON.parse(utf8.decode(modelEntry).replace(/^\uFEFF/, ''));
      const material = resolveMaterial(model);
      if (!material) {
        // No material means no texture means no picture.
        hide('模型没有可解析的材质');
        continue;
      }

      const materialEntry = getEntry(pkg, material.materialPath);
      if (!materialEntry) {
        skipped.push(layer.name + ': material ' + material.materialPath + ' missing');
        hide('材质文件缺失：' + material.materialPath);
        continue;
      }
      const parsed = JSON.parse(utf8.decode(materialEntry).replace(/^\uFEFF/, '')) as {
        passes?: { textures?: string[] }[];
      };
      const texName = parsed.passes?.[0]?.textures?.[0];
      const tex = texName ? await load(texName) : null;
      if (tex && isUniform(tex)) {
        // A flat fill standing in for something Wallpaper Engine would have
        // coloured at run time. Drawing it puts an opaque block on the picture.
        hide('纹理是单一颜色（WE 运行时染色的填充层）');
        continue;
      }
      if (texName && tex) {
        layer.textureName = texName;
        resolved += 1;
      } else {
        // The rasteriser falls back to a 1x1 white texture for a layer with no
        // texture, which paints a solid white rectangle. In Wallpaper Engine an
        // empty layer is transparent, so hide it instead of drawing a box.
        hide(texName ? '纹理解码失败：' + texName : '材质没有指定纹理');
        continue;
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
      hide('解析出错：' + (err as Error).message);
      continue;
    }
    drawn.push({
      index,
      name: String(layer.name ?? ''),
      texture: layer.textureName ?? null,
      average: layer.textureName ? averageColour(textures.get(layer.textureName) as never) : null,
    });
  }

  return { textures, resolved, skipped, hidden, drawn };
}
