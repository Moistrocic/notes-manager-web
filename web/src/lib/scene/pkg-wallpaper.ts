/**
 * The complete wallpaper picture inside a `scene.pkg`.
 *
 * The custom wallpaper stores one picture, not a live scene: a 45 MB container
 * would defeat the whole point (a few hundred kilobytes of WebP). The bottom
 * layer of a scene is nearly always the finished artwork, so it is read straight
 * out of the package - `scene.json` -> layer -> model -> material -> texture -
 * and decoded with the same texture decoder the live renderer uses. That covers
 * the usual case with no quality lost to a frame grab.
 *
 * Not every scene keeps its artwork as a plain image layer: the bottom layer may
 * be built from effects, or its material may sample one of Wallpaper Engine's
 * built-in textures that the package does not contain. Then the scene is
 * composited to a single frame with `renderSceneStill` - the same path the scene
 * wallpaper preview already uses - and that frame becomes the picture.
 *
 * Everything here is browser side: both paths need a canvas, and the result goes
 * through the same shrink pipeline as an imported photograph.
 */
import {
  PackageArchive,
  createSceneFromArchive,
  decodeTexImage,
  parseTex,
  type SceneDocument,
  type TexContainer,
  type TexImage,
} from 'wallpaper-scene-layers';
import { renderSceneStill } from './render-still';

export type PkgPictureSource = 'layer' | 'still';

export interface PkgWallpaperPicture {
  /** The complete wallpaper picture, ready for the shrink pipeline. */
  blob: Blob;
  fileName: string;
  width: number;
  height: number;
  /** Bytes of the picture before it is shrunk. */
  bytes: number;
  /** `layer`: read from the bottom image layer's texture; `still`: one rendered frame. */
  source: PkgPictureSource;
  /** What it came from, for the toast and the log. */
  note: string;
}

/** A package that cannot yield a picture, with a message meant for the user. */
export class PkgWallpaperError extends Error {}

/**
 * What the extracted picture may be decoded at. A 4K scene is 3840 x 2160 and
 * comes through untouched (the shrink pipeline cuts it to 2560 anyway); a 8K
 * layer would cost a 130 MB RGBA buffer and is read from a smaller mip instead.
 */
const MAX_PICTURE_EDGE = 4096;

export function isScenePkg(file: File): boolean {
  return /\.pkg$/i.test(file.name);
}

function withoutExtension(name: string): string {
  return name.replace(/\.[^./\\]+$/, '') || 'scene';
}

interface LayerTexture {
  path: string;
  container: TexContainer;
}

/**
 * The texture a model layer paints with, if the package actually contains it.
 *
 * Material texture names are relative to `materials/` and stored as
 * `materials/<name>.tex`. Engine built-ins such as `particle/halo` are not in
 * the package - those return null and the caller keeps looking.
 */
function resolveLayerTexture(
  archive: PackageArchive,
  scene: SceneDocument,
  layer: SceneDocument['layers'][number],
): LayerTexture | null {
  if (!layer.image) return null;
  const model = scene.getModel(layer.image);
  if (!model?.material) return null;
  const material = scene.getMaterial(model.material);
  if (!material) return null;
  for (const pass of material.passes) {
    for (const name of pass.textures) {
      if (!name) continue;
      const path = `materials/${name}.tex`;
      const bytes = archive.get(path);
      if (!bytes) continue;
      try {
        return { path, container: parseTex(bytes) };
      } catch {
        // A texture that will not parse is not the one; keep looking.
      }
    }
  }
  return null;
}

/** The largest stored mip that stays within the picture cap. */
function pickMip(images: TexImage[]): TexImage {
  const within = images.find(
    (image) => image.width > 0 && image.height > 0 && Math.max(image.width, image.height) <= MAX_PICTURE_EDGE,
  );
  return within ?? images[0];
}

/** Crops a padded (power of two) RGBA picture back to its real size. */
function cropRgba(pixels: Uint8Array, sourceWidth: number, width: number, height: number): Uint8Array {
  const cropped = new Uint8Array(width * height * 4);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y += 1) {
    const start = y * sourceWidth * 4;
    cropped.set(pixels.subarray(start, start + rowBytes), y * rowBytes);
  }
  return cropped;
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** One stored texture as a picture blob, at the texture's real size. */
async function pictureFromTexture(
  texture: LayerTexture,
  fileName: string,
): Promise<Omit<PkgWallpaperPicture, 'note'> | null> {
  const images = texture.container.images;
  if (images.length === 0) return null;
  const mip = pickMip(images);
  const decoded = decodeTexImage(mip);
  const header = texture.container.header;
  const width = Math.max(1, header.imageWidth || decoded.width);
  const height = Math.max(1, header.imageHeight || decoded.height);

  // The common case: Wallpaper Engine stored the artwork as PNG/JPEG in a .tex.
  if (decoded.format === 'file' && decoded.file && decoded.mimeType) {
    // A copy, so the Blob does not keep the whole 45 MB package alive.
    const blob = new Blob([decoded.file.slice().buffer as ArrayBuffer], { type: decoded.mimeType });
    return { blob, fileName: `${withoutExtension(fileName)}.${decoded.mimeType === 'image/png' ? 'png' : 'jpg'}`, width, height, bytes: blob.size, source: 'layer' };
  }
  if (!decoded.pixels) return null;
  // Raw and block compressed mips can be padded to a power of two; the header
  // knows the real size.
  const pixels =
    decoded.width === width && decoded.height === height
      ? decoded.pixels
      : cropRgba(decoded.pixels, decoded.width, width, height);
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const clamped = new Uint8ClampedArray(pixels.byteLength);
  clamped.set(pixels);
  context.putImageData(new ImageData(clamped, width, height), 0, 0);
  const blob = await canvasBlob(canvas, 'image/png');
  if (!blob) return null;
  return { blob, fileName: `${withoutExtension(fileName)}.png`, width, height, bytes: blob.size, source: 'layer' };
}

/** The bottom image layer's texture, in painting order (layer 0 first). */
async function pictureFromBottomLayer(
  archive: PackageArchive,
  scene: SceneDocument,
  fileName: string,
): Promise<PkgWallpaperPicture | null> {
  for (const layer of scene.layers) {
    const texture = resolveLayerTexture(archive, scene, layer);
    if (!texture) continue;
    const picture = await pictureFromTexture(texture, fileName);
    if (!picture) continue;
    return { ...picture, note: layer.name ? `${layer.name}（${texture.path}）` : texture.path };
  }
  return null;
}

/**
 * Reads a scene.pkg and hands back its complete wallpaper picture.
 *
 * `onProgress` receives short user-facing status lines: reading a 45 MB package
 * and decoding a 4K texture is not instant, and a frozen dialog looks broken.
 */
export async function pictureFromScenePkg(
  file: File,
  onProgress?: (message: string) => void,
): Promise<PkgWallpaperPicture> {
  if (!isScenePkg(file)) throw new PkgWallpaperError('这不是 .pkg 场景包');
  if (file.size === 0) throw new PkgWallpaperError('这个场景包是空的');
  onProgress?.('正在读取场景包…');
  const bytes = new Uint8Array(await file.arrayBuffer());

  let archive: PackageArchive;
  try {
    archive = new PackageArchive(bytes);
  } catch {
    throw new PkgWallpaperError('这个文件不是 Wallpaper Engine 的场景包（scene.pkg）');
  }
  let scene: SceneDocument;
  try {
    scene = createSceneFromArchive(archive);
  } catch {
    throw new PkgWallpaperError('场景包里的 scene.json 读不出来');
  }

  onProgress?.('正在从场景包里取完整的壁纸图…');
  try {
    const direct = await pictureFromBottomLayer(archive, scene, file.name);
    if (direct) return direct;
  } catch {
    // Fall through to the rendered frame: a texture that cannot be decoded is
    // still a scene that can be drawn.
  }

  onProgress?.('场景包里没有可直接取出的贴图，正在渲染整张背景…');
  const container = bytes.slice().buffer as ArrayBuffer;
  try {
    const still = await renderSceneStill(container, {
      cacheKey: `pkg:${file.name}:${file.size}:${file.lastModified}`,
      useCache: false,
    });
    return {
      blob: still.blob,
      fileName: `${withoutExtension(file.name)}.jpg`,
      width: still.width,
      height: still.height,
      bytes: still.blob.size,
      source: 'still',
      note: '场景渲染帧',
    };
  } catch (err) {
    throw new PkgWallpaperError(`从场景包里取图失败：${(err as Error).message}`);
  }
}
