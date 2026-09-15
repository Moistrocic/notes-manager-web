/** Hand-written types for the vendored we-scene texture decoder. */
export declare const TEXTURE_FORMATS: Record<number, string>;
export declare const FIF: {
  UNKNOWN: -1;
  JPEG: 2;
  PNG: 13;
  GIF: 25;
  WEBP: 35;
  MP4: 35;
};

export interface Tex {
  width: number;
  height: number;
  format: number;
  isVideo: boolean;
  freeImageFormat: number;
  images: { width: number; height: number; data: Uint8Array }[][];
}

export type DecodedMip0 =
  | { width: number; height: number; video: Uint8Array }
  | { width: number; height: number; png: Uint8Array }
  | { width: number; height: number; image: Uint8Array; fif: number }
  | { width: number; height: number; rgba: Uint8Array };

export type DecodedMip =
  | { width: number; height: number; rgba: Uint8Array }
  | { width: number; height: number; image: Uint8Array; fif: number };

export function parseTex(buf: Uint8Array): Tex;
export function decodeMip0(tex: Tex): DecodedMip0;
export function decodeMips(tex: Tex): DecodedMip[];
export function decodePixels(format: number, data: Uint8Array, w: number, h: number): Uint8Array;
export function lz4Decompress(src: Uint8Array, outSize: number): Uint8Array;
