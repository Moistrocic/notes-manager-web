/** Hand-written types for the vendored we-scene parser. See PROVENANCE.md. */
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
export function parsePkg(buf: Uint8Array): Pkg;
/** A copy of one entry, or null when the container has no such path. */
export function getEntry(pkg: Pkg, name: string): Uint8Array | null;
export function verifyLayout(pkg: Pkg): { dataEnd: number; fileSize: number; ok: boolean };
