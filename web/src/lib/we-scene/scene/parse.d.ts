/** Hand-written types for the vendored we-scene scene parser. */
export interface SceneLayer {
  name: string;
  visible: boolean;
  image?: string;
  solid?: boolean;
  particle?: boolean;
  textureName?: string;
  effects?: { passes?: { textures?: string[] }[] }[];
  [key: string]: unknown;
}
export interface Scene {
  layers: SceneLayer[];
  general?: Record<string, unknown>;
  camera?: Record<string, unknown>;
  [key: string]: unknown;
}
export function parseScene(sceneJson: unknown, project: unknown): Scene;
export function resolveMaterial(modelJson: unknown): { materialPath: string } | null;
export function parseVec3(s: string): number[];
export function parseVec2(s: string): number[];
export function parseColor(c: string): number[];
export function parseBool(v: unknown, dflt?: boolean): boolean;
