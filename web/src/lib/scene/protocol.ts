/** Messages between the page and the scene render worker. */

export interface StillRequest {
  id: number;
  /** The whole scene.pkg. Transferred, not copied. */
  bytes: ArrayBuffer;
  /** Cap on the rendered width; the frame is scaled down to fit. */
  maxWidth: number;
  quality: number;
}

export interface StillResponse {
  id: number;
  ok: boolean;
  blob?: Blob;
  width?: number;
  height?: number;
  /** Layers actually drawn. */
  drawn?: number;
  /** Layers that found their texture. */
  resolved?: number;
  /** Textures or layers that could not be decoded. */
  skipped?: number;
  error?: string;
}
