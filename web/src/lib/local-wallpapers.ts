/**
 * The wallpapers that are already on this computer.
 *
 * A web page cannot read an arbitrary path - there is no API for it, and
 * `showDirectoryPicker()` has to be driven by a click - so Steam itself cannot
 * be located automatically. What the browser *can* do is hand over a whole tree
 * at once, so the user grants one folder (their Steam directory, a drive root,
 * or the wallpaper folder itself) and everything after that is automatic: we
 * look for Wallpaper Engine's library inside it, remember the handle, and list
 * the wallpapers with their previews on every later visit.
 *
 *  1. File System Access API (`showDirectoryPicker`) - Chrome and Edge. The
 *     handle survives a reload because IndexedDB can store it, so coming back
 *     later costs one permission click at most, or none at all if the user
 *     chose "allow on every visit".
 *  2. `<input type="file" webkitdirectory>` - Firefox, Safari and the rest.
 *     The listing only lives for this page load, which is why the chosen
 *     wallpaper is copied into IndexedDB: the picture keeps working after a
 *     reload even when the folder listing does not.
 *
 * Nothing is ever uploaded.
 */

import { idbDelete, idbGet, idbPut, wallpaperKindOf } from './wallpaper';

const HANDLE_KEY = 'wallpaper-folder';

/**
 * Whether the browser can put this file on screen by itself.
 *
 * Kept apart from wallpaperKindOf, which also answers "is this a scene" - a
 * question whose answer is no as far as a plain <img> or <video> is concerned,
 * and which decides whether a folder has to fall back to its preview still.
 */
function displayable(name: string): boolean {
  const kind = wallpaperKindOf(name);
  return kind === 'image' || kind === 'video';
}


/**
 * Works out which folder the wallpapers are actually in.
 *
 * Whatever the user hands over is searched, at any depth: a folder of
 * Wallpaper Engine projects, one wallpaper folder on its own, or a whole
 * drive. It used to guess at Steam's own layout first - looking for 431960
 * under the paths Steam normally uses, then walking the tree for a folder with
 * that name. The guessing is gone. It only ever helped people who keep Steam
 * where Steam puts it, and it made every other folder slower to open.
 */
async function resolveRoot(picked: DirHandleLike): Promise<ResolvedRoot> {
  // Whatever was picked is the root, and the search starts there. There is no
  // second guess to make: the recursion looks for wallpaper folders and falls
  // back to loose pictures on its own, so both a Steam directory and a folder
  // of holiday photos come out right.
  return { handle: picked, trail: [picked.name], detected: false, engine: true };
}

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
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirHandleLike>;
  queryPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

type PickerWindow = Window & {
  showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<DirHandleLike>;
};

export interface WallpaperEntry {
  /** Path relative to the wallpaper root. Unique, and the key of the grid. */
  path: string;
  /** project.json title, else a tidied up folder or file name. */
  title: string;
  /** What the wallpaper is, when the folder is a Wallpaper Engine one. */
  type?: string;
  /** Path of the file to apply, relative to the root. Absent if unusable. */
  file?: string;
  kind?: 'image' | 'video' | 'scene';
  /** Path of the preview image, relative to the root. */
  preview?: string;
  /**
   * True when `file` is only the wallpaper's preview still, because the real
   * thing cannot be drawn by a browser - a Wallpaper Engine scene is a packed
   * scene.pkg with compiled shaders, and there is no way to run it here.
   */
  still?: boolean;
  /** Why it is a still, or why there is nothing to use at all. */
  note?: string;
  /**
   * Path of the scene.pkg, relative to the root, when this is a Wallpaper
   * Engine scene. Compositing it gives the real background; the preview is only
   * a square workshop thumbnail.
   */
  scene?: string;
}

export interface WallpaperLibrary {
  /** Which mechanism produced the listing. */
  via: 'directory' | 'input';
  /** The folder that ended up being used. */
  label: string;
  /** The path walked to reach it, for the header: ["Steam", "steamapps", ...]. */
  trail: string[];
  /** True when the library was found by looking inside what the user picked. */
  detected: boolean;
  entries: WallpaperEntry[];
  /** True when the folder held more wallpapers than we are willing to list. */
  truncated: boolean;
}

/** How deep to walk a plain folder. Wallpaper Engine nests one level. */
/**
 * How deep to look. Eight covers the layouts people have without being one
 * they have to think about: a wallpaper is five levels below a Steam folder,
 * so this also reaches it from a folder above that - "Games", or a drive root.
 * The entry budget is what really bounds the work.
 */
const MAX_DEPTH = 8;
/** More than this and the grid stops being useful. */
const MAX_ENTRIES = 240;

/** The packed scene of a Wallpaper Engine scene wallpaper. */
export const SCENE_PACK = 'scene.pkg';
/** Names Wallpaper Engine uses for the still that represents a wallpaper. */
const PREVIEW_NAMES = ['preview.jpg', 'preview.gif', 'preview.png', 'preview.jpeg', 'preview.webp'];
/** Names it uses for the artwork itself. */
const PLAYABLE_NAMES = [
  'wallpaper.mp4',
  'wallpaper.webm',
  'wallpaper.jpg',
  'wallpaper.jpeg',
  'wallpaper.png',
  'wallpaper.webp',
  'wallpaper.gif',
];

/** Supported here and now? Both paths work, so this only decides the label. */
export function canPickDirectory(): boolean {
  return typeof window !== 'undefined' && typeof (window as PickerWindow).showDirectoryPicker === 'function';
}

/* -------------------------------------------------------------------------- */
/* Finding the library                                                        */
/* -------------------------------------------------------------------------- */
/** Walks a chain of folder names, or gives up quietly. */


interface ResolvedRoot {
  handle: DirHandleLike;
  trail: string[];
  detected: boolean;
  /** True when the folders inside are individual wallpapers. */
  engine: boolean;
}

/* -------------------------------------------------------------------------- */
interface EngineProject {
  title?: string;
  type?: string;
  file?: string;
}

function parseProject(text: string): EngineProject {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    return {
      title: typeof parsed.title === 'string' ? parsed.title : undefined,
      type: typeof parsed.type === 'string' ? parsed.type : undefined,
      file: typeof parsed.file === 'string' ? parsed.file : undefined,
    };
  } catch {
    return {};
  }
}

/** "my_cool-wallpaper" -> "My cool wallpaper". */
function tidyName(raw: string): string {
  const spaced = raw.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!spaced) return raw;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Why the wallpaper itself cannot be drawn in a browser. */
function unplayableReason(type: string | undefined): string {
  if (type === 'web') return '网页壁纸，浏览器无法作为背景运行';
  if (type === 'application') return '应用程序壁纸，浏览器无法播放';
  return '场景壁纸（scene.pkg），浏览器无法播放';
}

/**
 * One Wallpaper Engine wallpaper folder.
 *
 * A scene wallpaper is a packed `scene.pkg` that only Wallpaper Engine can
 * draw, but its `preview.jpg`/`preview.gif` is a perfectly good picture, so
 * those entries are listed and marked rather than hidden.
 */
async function readEngineWallpaper(
  dir: DirHandleLike,
  prefix: string,
  files: Map<string, FileHandleLike | File>,
): Promise<WallpaperEntry> {
  const byName = new Map<string, FileHandleLike>();
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file') byName.set(name, handle);
  }

  let project: EngineProject = {};
  const projectFile = byName.get('project.json');
  if (projectFile) {
    try {
      project = parseProject(await (await projectFile.getFile()).text());
    } catch {
      /* an unreadable project.json just means no title */
    }
  }

  const register = (name: string) => {
    const path = prefix ? `${prefix}/${name}` : name;
    files.set(path, byName.get(name) as FileHandleLike);
    return path;
  };

  const previewName = PREVIEW_NAMES.find((name) => byName.has(name));
  const preview = previewName ? register(previewName) : undefined;
  const sceneName = byName.has(SCENE_PACK) ? SCENE_PACK : undefined;
  const scene = sceneName ? register(sceneName) : undefined;

  // project.json names the artwork. Fall back to the conventional names, then
  // to anything in the folder a browser can actually open.
  const preferred = project.file && displayable(project.file) && byName.has(project.file) ? project.file : undefined;
  const playable =
    preferred ??
    PLAYABLE_NAMES.find((name) => byName.has(name) && displayable(name)) ??
    // Anything a browser can open, but never the preview still: that is the
    // thumbnail, and using it would silently downgrade the wallpaper.
    [...byName.keys()].find((name) => displayable(name) && !PREVIEW_NAMES.includes(name));

  const kind = playable ? wallpaperKindOf(playable) : null;
  // Nothing playable: fall back to the preview still rather than leaving the
  // wallpaper unusable. A `preview.gif` is an ordinary image to the browser,
  // so a fair number of scenes end up animated anyway.
  const fallback = playable ? undefined : preview;
  const file = playable ? register(playable) : fallback;

  return {
    path: file ?? prefix ?? dir.name,
    title: project.title?.trim() || tidyName(dir.name),
    type: project.type,
    file,
    kind: playable ? (kind ?? undefined) : fallback ? 'image' : undefined,
    preview,
    scene,
    still: Boolean(fallback),
    note: playable
      ? undefined
      : scene
        ? '场景壁纸：由 scene.pkg 合成完整背景图（预览图只是方形缩略图）'
        : fallback
          ? `${unplayableReason(project.type)}，这里改用它的静态预览图`
          : `${unplayableReason(project.type)}，而且它没有预览图`,
  };
}

/** A folder of loose pictures and videos. */
async function walk(
  dir: DirHandleLike,
  prefix: string,
  depth: number,
  files: Map<string, FileHandleLike | File>,
  entries: WallpaperEntry[],
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
    entries.push({ path, title: tidyName(name), file: path, kind });
  }
}

/** Names that mark a folder as a wallpaper rather than a folder of them. */
const WALLPAPER_MARKERS = ['project.json', SCENE_PACK];

/**
 * Recurses until it finds folders that are wallpapers.
 *
 * This is the whole of the search now that the guessing at Steam's layout is
 * gone: whatever the user pointed at is walked, at any depth, and every folder
 * that holds a wallpaper is an entry. A folder that is one is not descended
 * into, or its textures would be listed as wallpapers too.
 */
async function collect(
  dir: DirHandleLike,
  prefix: string,
  depth: number,
  files: Map<string, FileHandleLike | File>,
  entries: WallpaperEntry[],
): Promise<void> {
  if (depth > MAX_DEPTH || entries.length >= MAX_ENTRIES) return;

  const children: [string, DirHandleLike | FileHandleLike][] = [];
  for await (const [name, handle] of dir.entries()) {
    if (name.startsWith('.')) continue;
    children.push([name, handle]);
  }

  const folders = children.filter((pair): pair is [string, DirHandleLike] => pair[1].kind === 'directory');

  // A folder with a project or a scene in it is one wallpaper. Checked at the
  // root as well: pointing straight at a wallpaper is an ordinary thing to do,
  // and descending into it would list its textures as wallpapers of their own.
  if (children.some(([name]) => WALLPAPER_MARKERS.includes(name))) {
    entries.push(await readEngineWallpaper(dir, prefix, files));
    return;
  }

  // A folder with folders in it is a container, whatever else it holds: a Steam
  // directory has loose files scattered through it, and a library folder has
  // one per wallpaper.
  if (folders.length > 0) {
    for (const [name, handle] of folders) {
      if (entries.length >= MAX_ENTRIES) return;
      await collect(handle, prefix ? `${prefix}/${name}` : name, depth + 1, files, entries);
    }
    return;
  }

  // Nothing but files: each picture is a wallpaper of its own, which is what a
  // folder someone assembled by hand looks like.
  for (const [name, handle] of children) {
    if (entries.length >= MAX_ENTRIES) return;
    const kind = wallpaperKindOf(name);
    if (!kind || handle.kind !== 'file') continue;
    const path = prefix ? `${prefix}/${name}` : name;
    files.set(path, handle);
    entries.push({ path, title: tidyName(name), file: path, kind });
  }
}

function sortEntries(entries: WallpaperEntry[]): WallpaperEntry[] {
  return entries.sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }));
}

/** Reads a resolved root into entries plus the handle map they refer to. */
async function listRoot(resolved: ResolvedRoot): Promise<{
  entries: WallpaperEntry[];
  files: Map<string, FileHandleLike | File>;
  truncated: boolean;
}> {
  const files = new Map<string, FileHandleLike | File>();
  const entries: WallpaperEntry[] = [];

  if (resolved.engine) {
    // The picked folder may be one wallpaper, a folder of them, or something
    // well above both - a Steam directory, a drive. Walk down until a folder
    // looks like a wallpaper; that one is an entry and its insides are not
    // searched further, which is what keeps a wallpaper's own files from being
    // offered as wallpapers of their own.
    await collect(resolved.handle, '', 1, files, entries);
    // Nothing that looked like a wallpaper: fall back to loose pictures, which
    // is what an ordinary folder of images is.
    if (entries.length === 0) await walk(resolved.handle, '', 1, files, entries);
  } else {
    await walk(resolved.handle, '', 1, files, entries);
  }

  return { entries: sortEntries(entries), files, truncated: entries.length >= MAX_ENTRIES };
}

async function openRoot(handle: DirHandleLike, via: 'directory' | 'input'): Promise<WallpaperLibrary> {
  const resolved = await resolveRoot(handle);
  const { entries, files, truncated } = await listRoot(resolved);
  openFiles = files;
  openLibrary = {
    via,
    label: resolved.handle.name,
    trail: resolved.trail,
    detected: resolved.detected,
    entries,
    truncated,
  };
  return openLibrary;
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

async function readPath(path: string): Promise<File> {
  const handle = openFiles.get(path);
  if (!handle) throw new Error('壁纸文件夹已失效，请重新选择');
  return handle instanceof File ? handle : await handle.getFile();
}

/** The file behind a grid cell, read on demand. */
export async function readEntry(entry: WallpaperEntry): Promise<File> {
  const target = entry.file ?? entry.preview;
  if (!target) throw new Error('这个壁纸没有可用的文件');
  return readPath(target);
}

/** The preview image, read on demand. Falls back to the wallpaper itself. */
export async function readPreview(entry: WallpaperEntry): Promise<File> {
  return readPath(entry.preview ?? entry.file ?? entry.path);
}

/** Any path inside the open library, for files the entry does not point at. */
export async function readLibraryFile(path: string): Promise<File> {
  return readPath(path);
}

/* -------------------------------------------------------------------------- */
/* Choosing a folder                                                          */
/* -------------------------------------------------------------------------- */
export type PickResult =
  | { status: 'ok'; library: WallpaperLibrary }
  | { status: 'cancelled' }
  | { status: 'unsupported' };

/** Opens the folder picker and looks for the wallpaper library inside. */
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

  const library = await openRoot(handle, 'directory');
  void idbPut(HANDLE_KEY, handle);
  return { status: 'ok', library };
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

  try {
    return { status: 'ok', library: await openRoot(handle, 'directory') };
  } catch {
    await idbDelete(HANDLE_KEY);
    return { status: 'empty' };
  }
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
/* -------------------------------------------------------------------------- */
/* Fallback: <input type="file" webkitdirectory>                              */
/* -------------------------------------------------------------------------- */
/** The path the browser reported, including the folder the user chose. */
function fullPath(file: File): string {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
}

/** Path of an input file relative to the chosen folder. */
function relativePath(file: File): string {
  return fullPath(file).split('/').slice(1).join('/');
}

/**
/**
 * A file's path inside the chosen folder, or null when it is not under it.
 *
 * It used to return null unless the path ran through Wallpaper Engine's
 * Steam id, which quietly hid every wallpaper in a folder that was not laid
 * out the way Steam lays one out. Anything the user pointed at is fair game
 * now; the search is what decides whether it is a wallpaper.
 */
function insideLibrary(file: File): string | null {
  const path = fullPath(file);
  return path ? path : null;
}

/**
 * Lists the files a directory input produced.
 *
 * The same Steam rules apply - anything under a ".../431960/" segment is
 * library content, grouped one folder per wallpaper - because the picker is the
 * same and only the plumbing differs.
 */
export function libraryFromFiles(files: FileList | File[], label: string): WallpaperLibrary {
  const list = Array.from(files);
  const nextFiles = new Map<string, FileHandleLike | File>();
  const entries: WallpaperEntry[] = [];
  const libraryFiles = list.filter((file) => insideLibrary(file) !== null);

  if (libraryFiles.length > 0) {
    const folders = new Map<string, File[]>();
    for (const file of libraryFiles) {
      const inside = insideLibrary(file) as string;
      const folder = inside.split('/')[1];
      if (!folder || folder.startsWith('.')) continue;
      folders.set(folder, [...(folders.get(folder) ?? []), file]);
    }

    for (const [folder, folderFiles] of folders) {
      if (entries.length >= MAX_ENTRIES) break;
      const byName = new Map(folderFiles.map((file) => [file.name, file]));
      const previewFile = PREVIEW_NAMES.map((name) => byName.get(name)).find(Boolean);
      const playableName =
        PLAYABLE_NAMES.find((name) => byName.has(name) && displayable(name)) ??
        [...byName.keys()].find((name) => displayable(name) && !PREVIEW_NAMES.includes(name));
      const playableFile = playableName ? byName.get(playableName) : undefined;
      const previewKey = previewFile ? `${folder}/${previewFile.name}` : undefined;
      // Same fallback as the handle path: a scene is offered as its still.
      const key = `${folder}/${playableName ?? previewFile?.name ?? folder}`;
      if (playableFile) nextFiles.set(key, playableFile);
      if (previewFile && previewKey) nextFiles.set(previewKey, previewFile);
      const usesPreview = !playableFile && Boolean(previewKey);
      entries.push({
        path: playableFile || !previewKey ? key : previewKey,
        title: tidyName(folder),
        file: playableFile ? key : previewKey,
        kind: playableName ? (wallpaperKindOf(playableName) ?? undefined) : usesPreview ? 'image' : undefined,
        preview: previewKey,
        still: usesPreview,
        note: playableFile
          ? undefined
          : usesPreview
            ? `${unplayableReason(undefined)}，这里改用它的静态预览图`
            : `${unplayableReason(undefined)}，而且它没有预览图`,
      });
    }
  } else {
    for (const file of list) {
      if (entries.length >= MAX_ENTRIES) break;
      const path = relativePath(file);
      if (path.split('/').some((part) => part.startsWith('.'))) continue;
      const kind = wallpaperKindOf(file.name);
      if (!kind) continue;
      nextFiles.set(path, file);
      entries.push({ path, title: tidyName(file.name), file: path, kind });
    }
  }

  openFiles = nextFiles;
  openLibrary = {
    via: 'input',
    label,
    trail: [label],
    detected: libraryFiles.length > 0,
    entries: sortEntries(entries),
    truncated: list.length >= MAX_ENTRIES,
  };
  return openLibrary;
}
