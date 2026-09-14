/**
 * The wallpapers that are already on this computer.
 *
 * A web page cannot read arbitrary paths, so the folder has to be handed over
 * by the user once. Two ways, in order of preference:
 *
 *  1. File System Access API (`showDirectoryPicker`) - Chrome and Edge. The
 *     user picks a folder, we get a handle, and the handle survives a reload
 *     because IndexedDB can store it. Coming back later re-asks for permission
 *     with one click instead of a full folder walk.
 *  2. `<input type="file" webkitdirectory>` - Firefox, Safari, and anything
 *     else. The user picks the same folder and the browser hands over the file
 *     list. It only lives for this page load, which is why the chosen wallpaper
 *     is copied into IndexedDB: the picture keeps working after a reload even
 *     when the folder listing does not.
 *
 * Nothing is ever uploaded. Point this at a Wallpaper Engine library
 * (steamapps/workshop/content/431960) and the stills and videos show up
 * together.
 */

import { idbDelete, idbGet, idbPut, wallpaperKindOf } from './wallpaper';

const HANDLE_KEY = 'wallpaper-folder';

/** How deep to walk. Wallpaper Engine nests one level; two is plenty. */
const MAX_DEPTH = 3;
/** More than this and the grid stops being useful. */
const MAX_ENTRIES = 240;

/* -------------------------------------------------------------------------- */
/* Minimal File System Access typings, so this does not depend on the TS lib  */
/* -------------------------------------------------------------------------- */
interface FileHandleLike {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}

interface DirHandleLike {
  kind: 'directory';
  name: string;
  entries(): AsyncIterableIterator<[string, DirHandleLike | FileHandleLike]>;
  queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

type PickerWindow = Window & {
  showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<DirHandleLike>;
};

export interface LocalWallpaper {
  /** File name, shown in the grid. */
  name: string;
  /** Path relative to the picked folder, '/'-separated. Unique. */
  path: string;
  kind: 'image' | 'video';
}

export interface WallpaperLibrary {
  /** Which mechanism produced the listing. */
  via: 'directory' | 'input';
  /** Folder name, for the header. */
  label: string;
  entries: LocalWallpaper[];
  /** True when the folder held more files than we are willing to list. */
  truncated: boolean;
}

/** Supported here and now? Both paths work, so this only decides the label. */
export function canPickDirectory(): boolean {
  return typeof window !== 'undefined' && typeof (window as PickerWindow).showDirectoryPicker === 'function';
}

/* -------------------------------------------------------------------------- */
/* Listing                                                                    */
/* -------------------------------------------------------------------------- */
async function walk(
  dir: DirHandleLike,
  prefix: string,
  depth: number,
  files: Map<string, FileHandleLike>,
  entries: LocalWallpaper[],
): Promise<void> {
  if (depth > MAX_DEPTH || entries.length >= MAX_ENTRIES) return;
  for await (const [name, handle] of dir.entries()) {
    if (entries.length >= MAX_ENTRIES) return;
    if (name.startsWith('.')) continue;
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === 'directory') {
      await walk(handle, path, depth + 1, files, entries);
      continue;
    }
    const kind = wallpaperKindOf(name);
    if (!kind) continue;
    files.set(path, handle);
    entries.push({ name, path, kind });
  }
}

function sortEntries(entries: LocalWallpaper[]): LocalWallpaper[] {
  return entries.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }));
}

/* -------------------------------------------------------------------------- */
/* Module state: the folder that is open right now                            */
/* -------------------------------------------------------------------------- */
let openFiles = new Map<string, FileHandleLike | File>();
let openLibrary: WallpaperLibrary | null = null;

export function currentLibrary(): WallpaperLibrary | null {
  return openLibrary;
}

export function closeLibrary(): void {
  openFiles = new Map();
  openLibrary = null;
}

/** The file behind a grid cell, read on demand. */
export async function readEntry(entry: LocalWallpaper): Promise<File> {
  const handle = openFiles.get(entry.path);
  if (!handle) throw new Error('壁纸文件夹已失效，请重新选择');
  return handle instanceof File ? handle : await handle.getFile();
}

/* -------------------------------------------------------------------------- */
/* Choosing a folder                                                          */
/* -------------------------------------------------------------------------- */
export type PickResult =
  | { status: 'ok'; library: WallpaperLibrary }
  | { status: 'cancelled' }
  | { status: 'unsupported' };

/** Opens the folder picker (or the directory input) and lists what is inside. */
export async function pickLibrary(): Promise<PickResult> {
  const picker = typeof window === 'undefined' ? undefined : (window as PickerWindow).showDirectoryPicker;
  if (!picker) return { status: 'unsupported' };

  let handle: DirHandleLike;
  try {
    handle = await picker({ id: 'notes-manager-wallpapers', mode: 'read' });
  } catch (err) {
    // the user closing the dialog is not an error worth reporting
    if ((err as Error)?.name === 'AbortError') return { status: 'cancelled' };
    throw err;
  }

  const files = new Map<string, FileHandleLike>();
  const entries: LocalWallpaper[] = [];
  await walk(handle, '', 1, files, entries);
  if (entries.length === 0) return { status: 'ok', library: { via: 'directory', label: handle.name, entries: [], truncated: false } };

  openFiles = files;
  openLibrary = {
    via: 'directory',
    label: handle.name,
    entries: sortEntries(entries),
    truncated: entries.length >= MAX_ENTRIES,
  };
  void idbPut(HANDLE_KEY, handle);
  return { status: 'ok', library: openLibrary };
}

export type RestoreResult =
  | { status: 'ok'; library: WallpaperLibrary }
  | { status: 'needs-permission'; label: string }
  | { status: 'empty' };

/** Re-opens the folder from a previous visit, if the browser still allows it. */
export async function restoreLibrary(): Promise<RestoreResult> {
  if (openLibrary) return { status: 'ok', library: openLibrary };
  const handle = await idbGet<DirHandleLike>(HANDLE_KEY);
  if (!handle || typeof handle.entries !== 'function') return { status: 'empty' };

  const permission = (await handle.queryPermission?.({ mode: 'read' })) ?? 'granted';
  if (permission !== 'granted') return { status: 'needs-permission', label: handle.name };

  const files = new Map<string, FileHandleLike>();
  const entries: LocalWallpaper[] = [];
  try {
    await walk(handle, '', 1, files, entries);
  } catch {
    await idbDelete(HANDLE_KEY);
    return { status: 'empty' };
  }
  openFiles = files;
  openLibrary = { via: 'directory', label: handle.name, entries: sortEntries(entries), truncated: entries.length >= MAX_ENTRIES };
  return { status: 'ok', library: openLibrary };
}

/** Re-asks for permission after a reload. Must run from a click. */
export async function grantLibrary(): Promise<RestoreResult> {
  const handle = await idbGet<DirHandleLike>(HANDLE_KEY);
  if (!handle) return { status: 'empty' };
  const permission = (await handle.requestPermission?.({ mode: 'read' })) ?? 'denied';
  if (permission !== 'granted') return { status: 'needs-permission', label: handle.name };
  return restoreLibrary();
}

/** Forgets the folder. The wallpaper itself stays until it is replaced. */
export async function forgetLibrary(): Promise<void> {
  closeLibrary();
  await idbDelete(HANDLE_KEY);
}

/* -------------------------------------------------------------------------- */
/* Fallback: <input type="file" webkitdirectory>                              */
/* -------------------------------------------------------------------------- */
/**
 * Lists the files a directory input produced. The File objects are kept in
 * memory for this page load only, which is enough to pick one, and the pick
 * itself is copied into IndexedDB so it outlives the listing.
 */
export function libraryFromFiles(files: FileList | File[], label: string): WallpaperLibrary {
  const list = Array.from(files);
  const nextFiles = new Map<string, FileHandleLike | File>();
  const entries: LocalWallpaper[] = [];
  for (const file of list) {
    if (entries.length >= MAX_ENTRIES) break;
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const path = relative.split('/').slice(1).join('/') || file.name;
    if (path.split('/').some((part) => part.startsWith('.'))) continue;
    const kind = wallpaperKindOf(file.name);
    if (!kind) continue;
    nextFiles.set(path, file);
    entries.push({ name: file.name, path, kind });
  }
  openFiles = nextFiles;
  openLibrary = { via: 'input', label, entries: sortEntries(entries), truncated: list.length >= MAX_ENTRIES };
  return openLibrary;
}
