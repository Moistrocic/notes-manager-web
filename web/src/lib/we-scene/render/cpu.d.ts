/** Hand-written types for the vendored we-scene software rasteriser. */
import type { Scene } from '../scene/parse.js';

export interface Texture {
  width: number;
  height: number;
  rgba: Uint8Array | null;
  rg88?: boolean;
  video?: boolean;
  mips?: { width: number; height: number; rgba: Uint8Array }[];
}

/** Composes one frame at `time` seconds into a bottom-up RGBA buffer. */
export function renderScene(
  scene: Scene,
  textures: Map<string, Texture>,
  width: number,
  height: number,
  time?: number,
): { rgba: Uint8Array; width: number; height: number; drawn: number };
