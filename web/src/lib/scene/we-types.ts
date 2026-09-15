/**
 * Structural types for the we-scene submodule.
 *
 * The submodule is plain JavaScript, so there are no types to import from it.
 * These describe the parts this app touches, which is also a useful summary of
 * the surface being relied on: everything else in that repository is unused.
 */

export interface PkgEntry {
  name: string;
  offset: number;
  size: number;
}

export interface Pkg {
  magic: string;
  version: string;
  count: number;
  entries: PkgEntry[];
  dataStart: number;
  fileSize: number;
  buf: Uint8Array;
}

/** A texture already decoded to RGBA, before it reaches the GPU. */
export interface Texture {
  width: number;
  height: number;
  rgba: Uint8Array | null;
  rg88?: boolean;
  /** A video texture layer; the still path skips these. */
  video?: boolean;
  mips?: { width: number; height: number; rgba: Uint8Array }[];
  /** Set once the live renderer has uploaded the pixels. */
  glTex?: WebGLTexture;
}

export interface SceneLayer {
  name: string;
  visible: boolean;
  image?: string | null;
  solid?: boolean;
  particle?: boolean;
  isContainer?: boolean;
  textureName?: string;
  effects?: { visible?: boolean; passes?: { textures?: string[] }[] }[];
  [key: string]: unknown;
}

export interface Scene {
  layers: SceneLayer[];
  general?: { orthogonalprojection?: { width?: number; height?: number } } & Record<string, unknown>;
  camera?: Record<string, unknown>;
  [key: string]: unknown;
}
