/** Messages between the page and the scene worker. */

export interface StillRequest {
  kind: 'still';
  id: number;
  /** The whole scene.pkg. Transferred, not copied. */
  bytes: ArrayBuffer;
  /** Cap on the rendered width; the frame is scaled down to fit. */
  maxWidth: number;
  quality: number;
}

export interface PlayRequest {
  kind: 'play';
  id: number;
  /** The wallpaper canvas, handed over for the worker to draw into. */
  canvas: OffscreenCanvas;
  bytes: ArrayBuffer;
  /** Cap on the render target; the scene is scaled down to fit. */
  maxWidth: number;
  /** Upper bound on frames per second; a wallpaper does not need more. */
  fps: number;
}

export interface StopRequest {
  kind: 'stop' | 'pause' | 'resume';
  id: number;
}

export type SceneRequest = StillRequest | PlayRequest | StopRequest;

export interface StillResponse {
  kind: 'still';
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

export interface PlayResponse {
  kind: 'play';
  id: number;
  ok: boolean;
  /** Sent once the first frame is up, then every thirty frames or so. */
  frames?: number;
  width?: number;
  height?: number;
  resolved?: number;
  skipped?: number;
  error?: string;
}

export type SceneResponse = StillResponse | PlayResponse;
