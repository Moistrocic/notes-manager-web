/** Hand-written types for the vendored we-scene WebGL renderer. */
import type { Scene } from '../scene/parse.js';
import type { Texture } from './cpu.js';

export interface Renderer {
  gl: WebGL2RenderingContext;
  /** Draws one frame. Async: shaders are translated and linked on first use. */
  render(scene: Scene, textures: Map<string, Texture>, width: number, height: number, time: number): Promise<void>;
  /** Forgets translated shaders; call when switching to a different scene. */
  resetShaderCaches(): void;
  /** 0 = full quality, 1 = cap the effect chain at screen size. */
  setFboCapFactor(value: number): void;
}

export interface RendererOptions {
  /** Returns the source of a shader inside the container, by relative path. */
  shaderResolver?: (relative: string) => Promise<string>;
}

export function createRenderer(canvas: OffscreenCanvas | HTMLCanvasElement, options?: RendererOptions): Renderer;
export function makeTexture(
  gl: WebGL2RenderingContext,
  rgba: Uint8Array,
  width: number,
  height: number,
  bitmap?: unknown,
): WebGLTexture;
export function makeTextureMip(gl: WebGL2RenderingContext, levels: unknown[], rg88?: boolean): WebGLTexture;
