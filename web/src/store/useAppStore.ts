import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { api, backgroundFileUrl, noteDownloadUrl } from '../lib/api';
import { stripMarkdown } from '../lib/markdown';
import { inManager, pushLocation, readLocation, replaceLocation } from '../lib/url';
import { applyFonts } from '../lib/fonts';
import {
  DEFAULT_WALLPAPER,
  clearWallpaperFile,
  loadWallpaperFile,
  loadWallpaperSettings,
  saveWallpaperFile,
  saveWallpaperSettings,
  wallpaperKindOf,
  type WallpaperKind,
  type WallpaperSettings,
  type WallpaperSource,
} from '../lib/wallpaper';
import type { AdminBackground } from '../lib/admin-background';
import { ApiError } from '../lib/types';
import type {
  AuthProviders,
  FolderCount,
  FontRecord,
  FontSelection,
  TrashedFolder,
  Note,
  NoteCapabilities,
  NoteStats,
  NoteSummary,
  SessionUser,
  SystemStatus,
  TagCount,
} from '../lib/types';

export type Theme = 'dark' | 'light';
export type SortKey = 'updated' | 'created' | 'title' | 'words';
/** Which way the sort runs. */
export type SortOrder = 'asc' | 'desc';
/** The sorts the picker offers, in the order it offers them. */
export const SORT_KEYS: SortKey[] = ['title', 'updated', 'created', 'words'];

/**
 * One row the user has picked out in the tree.
 *
 * Notes are addressed by id and folders by path, so the two live in one list
 * rather than each needing its own selection and its own batch action.
 */
export interface SelectionEntry {
  kind: 'note' | 'folder';
  /** Note id, or folder path. */
  id: string;
}

/** Which fields the search box looks at. All of them unless narrowed. */
export interface SearchScope {
  title: boolean;
  content: boolean;
  tags: boolean;
}

export const DEFAULT_SEARCH_SCOPE: SearchScope = { title: true, content: true, tags: true };
export type EditorMode = 'edit' | 'split' | 'preview';

export interface Toast {
  id: string;
  title: string;
  message?: string;
  tone: 'info' | 'success' | 'error';
  action?: { label: string; run: () => void | Promise<void> };
  createdAt: number;
}

export interface NotePatch {
  title?: string;
  content?: string;
  tags?: string[];
  pinned?: boolean;
  favorite?: boolean;
  color?: string | null;
  folder?: string;
}

interface AppState {
  booted: boolean;
  bootError: string | null;
  providers: AuthProviders | null;
  user: SessionUser | null;
  status: SystemStatus | null;
  authBusy: boolean;

  notes: NoteSummary[];
  tags: TagCount[];
  folders: FolderCount[];
  stats: NoteStats | null;
  capabilities: NoteCapabilities | null;
  loadingNotes: boolean;
  notesError: string | null;

  activeId: string | null;
  activeNote: Note | null;
  loadingNote: boolean;
  saving: boolean;
  dirty: boolean;
  lastSavedAt: number | null;
  /** Exactly what the server is known to hold for the open note. */
  lastSaved: NotePayload | null;

  query: string;
  activeTag: string | null;
  activeFolder: string | null;
  favoriteOnly: boolean;
  pinnedOnly: boolean;
  searchScope: SearchScope;
  setPinnedOnly: (value: boolean) => void;
  /** Folder paths the tree has open. */
  expandedFolders: string[];
  setExpandedFolders: (paths: string[]) => void;
  setSearchScope: (scope: SearchScope) => void;
  sort: SortKey;
  /** Ascending by default; the picker flips it. */
  sortOrder: SortOrder;
  /** Rows the tree has picked out, for the batch actions. */
  selection: SelectionEntry[];
  setSelection: (entries: SelectionEntry[]) => void;
  toggleSelection: (entry: SelectionEntry) => void;
  clearSelection: () => void;
  editorMode: EditorMode;
  sidebarOpen: boolean;
  /** Outline pane on the right of the editor. */
  metaOpen: boolean;
  /** Collapsible navigation block inside the merged left column. */

  /** Editor/preview split, 0.2 - 0.8. */
  splitRatio: number;
  /** Whether the two split panes scroll together. */
  syncScroll: boolean;
  toggleSyncScroll: (value?: boolean) => void;
  /** Focus mode hides the note list and every toolbar above the note. */
  focusMode: boolean;
  /** Panes to restore when leaving focus mode. */
  focusRestore: { sidebarOpen: boolean; metaOpen: boolean } | null;
  theme: Theme;
  trash: NoteSummary[];
  /** Folders in the trash, restored the same way notes are. */
  trashFolders: TrashedFolder[];
  restoreTrashFolder: (path: string) => Promise<void>;
  deleteTrashFolder: (path: string) => Promise<void>;
  trashOpen: boolean;
  settingsOpen: boolean;
  paletteOpen: boolean;
  toasts: Toast[];

  boot: () => Promise<void>;
  login: (input: {
    username: string;
    password: string;
    otp?: string;
    provider?: 'auto' | 'openlist' | 'local' | 'guest';
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshStatus: () => Promise<void>;

  refreshNotes: (options?: { silent?: boolean }) => Promise<void>;
  selectNote: (id: string, options?: { anchor?: string; replaceHistory?: boolean }) => Promise<void>;
  /** Follow a link inside a note: another note opens in the panel. */
  openInternalLink: (href: string) => Promise<void>;
  /** Open the note named by the current address (deep link / back button). */
  openFromLocation: () => Promise<void>;
  /** Anchor the editor should scroll to once the note has rendered. */
  pendingAnchor: string | null;
  setPendingAnchor: (anchor: string | null) => void;

  /* ------------------------------- appearance ------------------------------ */
  fonts: FontRecord[];
  fontSelection: FontSelection;
  loadFonts: () => Promise<void>;
  uploadFont: (file: File, name: string) => Promise<void>;
  deleteFont: (id: string) => Promise<void>;
  selectFonts: (selection: Partial<FontSelection>) => Promise<void>;

  wallpaper: WallpaperSettings;
  /** The URL the background layer should load (remote URL or blob URL). */
  wallpaperUrl: string | null;
  /**
   * What those bytes *are*, for caches that have to outlive the page.
   *
   * A blob URL is different on every load, so anything remembered under it is
   * remembered once and never found again. For a stored file this is its name,
   * size and timestamp; for a remote URL the URL itself.
   */
  wallpaperIdentity: string | null;
  /**
   * The administrator's default background, as the server reports it.
   *
   * Held separately from the user's own wallpaper rather than replacing it: the
   * switch that uses this is one the user can turn off, and turning it off
   * should give them back what they had, not a blank page.
   */
  adminBackground: AdminBackground | null;
  refreshAdminBackground: () => Promise<void>;
  /** Re-asks which sign-in methods the server offers. */
  refreshProviders: () => Promise<void>;
  /** The interface colour taken from the wallpaper, when that is turned on. */
  accent: string | null;
  setAccent: (colour: string | null) => void;
  /**
   * A frame of a live scene, as a data URL.
   *
   * A scene wallpaper is stored as its scene.pkg, which no img can show, so the
   * crop editor had nothing to draw. The layer captures one frame from the
   * canvas it is already running and keeps it here for the dialog.
   */
  scenePreview: string | null;
  setScenePreview: (preview: string | null) => void;
  /**
   * What the background layer is waiting for, if anything.
   *
   * A scene wallpaper is a 45 MB container that has to be fetched, parsed and
   * decoded before anything appears, and on a remote server that is a long time
   * to look at nothing. The layer reports what it is doing, and the indicator in
   * the corner says so.
   */
  wallpaperLoading: { label: string; ratio: number | null; rate: number | null } | null;
  setWallpaperLoading: (state: { label: string; ratio: number | null; rate: number | null } | null) => void;
  setWallpaper: (patch: Partial<WallpaperSettings>) => void;
  setWallpaperFile: (file: File, source?: WallpaperSource, kind?: WallpaperKind) => Promise<void>;
  clearWallpaper: () => Promise<void>;
  appearanceOpen: boolean;
  setAppearanceOpen: (value: boolean) => void;
  closeNote: () => void;
  createNote: (input?: { title?: string; folder?: string; content?: string }) => Promise<void>;
  /**
   * Uploads files into a folder. A note becomes a note; anything else - a
   * picture most obviously - is stored as it is. Returns how many arrived.
   */
  uploadFiles: (files: File[], folder?: string) => Promise<number>;
  patchActive: (patch: NotePatch, options?: { save?: boolean }) => void;
  saveActive: (immediate?: boolean) => Promise<void>;
  deleteNote: (id: string, options?: { permanent?: boolean }) => Promise<void>;
  restoreNote: (id: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  loadTrash: () => Promise<void>;
  togglePinned: (id: string) => Promise<void>;
  toggleFavorite: (id: string) => Promise<void>;
  setColor: (id: string, color: string | null) => Promise<void>;
  refreshMeta: () => Promise<void>;
  refreshWallpaperUrl: () => Promise<void>;
  createFolder: (path: string) => Promise<void>;
  deleteFolder: (path: string) => Promise<void>;
  renameFolder: (path: string, name: string) => Promise<void>;
  /** Moves a note to another folder. An empty string means the root. */
  moveNote: (id: string, folder: string) => Promise<void>;
  /** Moves several notes at once. */
  moveNotes: (ids: string[], folder: string) => Promise<void>;
  /** Moves everything the tree has selected - notes and folders alike. */
  moveSelection: (folder: string) => Promise<void>;
  /** Downloads everything the tree has selected, one file after another. */
  downloadSelection: () => Promise<void>;
  /** Sends everything the tree has selected to the trash. */
  deleteSelection: () => Promise<void>;
  /** Puts a batch deletion back, for the undo action on its toast. */
  restoreSelection: (notes: string[], folders: string[]) => Promise<void>;
  /** Moves a folder, contents and all, under another folder. */
  moveFolder: (path: string, target: string) => Promise<void>;
  /**
   * Renames a note. The title is the file name, so this renames the file on
   * disk too, and the note comes back with its new path.
   */
  renameNote: (id: string, title: string) => Promise<void>;
  /**
   * Publishes a note to the blog, or takes it off it, with the title and
   * summary the card should show. Empty strings mean no override.
   */
  setPublish: (id: string, patch: { published: boolean; title: string; summary: string }) => Promise<void>;
  /** Forgets a note's publish information; the note itself is left alone. */
  forgetPublish: (id: string) => Promise<void>;

  setQuery: (value: string) => void;
  setActiveTag: (tag: string | null) => void;
  setActiveFolder: (folder: string | null) => void;
  setFavoriteOnly: (value: boolean) => void;
  setSort: (sort: SortKey) => void;
  setSortOrder: (order: SortOrder) => void;
  setEditorMode: (mode: EditorMode) => void;
  toggleSidebar: (value?: boolean) => void;
  toggleMeta: (value?: boolean) => void;

  toggleFocusMode: (value?: boolean) => void;
  setSplitRatio: (value: number) => void;
  /** OpenList guest session (no credentials). */
  guestLogin: () => Promise<void>;
  setTheme: (theme: Theme) => void;
  setTrashOpen: (value: boolean) => void;
  setSettingsOpen: (value: boolean) => void;
  setPaletteOpen: (value: boolean) => void;

  pushToast: (toast: Omit<Toast, 'id' | 'createdAt'> & { id?: string }) => void;
  dismissToast: (id: string) => void;
}

const THEME_KEY = 'notes-manager-theme';
const SORT_KEY = 'notes-manager-sort';
const SORT_ORDER_KEY = 'notes-manager-sort-order';
const EXPANDED_KEY = 'notes-manager-expanded-folders';
const MODE_KEY = 'notes-manager-editor-mode';
const SPLIT_KEY = 'notes-manager-split-ratio';
const SYNC_SCROLL_KEY = 'notes-manager-sync-scroll';

/**
 * A save that was asked for while one was already in flight.
 *
 * Blurring two fields in a row used to drop the second request on the floor;
 * the note then sat dirty until the next blur. One flag is enough: when the
 * request settles, a queued save runs if anything is still unsaved.
 */
let saveQueued = false;

function readLocal<T extends string>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return (value as T) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

/**
 * Which folders the tree has open.
 *
 * Kept outside the component because hiding the note list unmounts it, and a
 * tree that forgets where you were every time you glance at a note is worse
 * than no tree.
 */
function readExpanded(): string[] {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function writeExpanded(paths: string[]): void {
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(paths));
  } catch {
    /* ignore */
  }
}

/**
 * A stable name for the wallpaper file that is stored right now.
 *
 * The blob URL handed to the layer changes on every page load, so it is no use
 * as a cache key; the file's own name, size and timestamp do not.
 */
function fileIdentity(blob: Blob): string {
  const file = blob as File;
  return `${file.name ?? 'wallpaper'}:${blob.size}:${file.lastModified ?? 0}`;
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#060a16' : '#f4f5fb');
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

function toSummary(note: Note): NoteSummary {
  const { content: _content, ...rest } = note;
  return { ...rest, excerpt: stripMarkdown(note.content, 200) };
}

/** The fields a save sends to the server, in a stable order for comparison. */
function notePayload(note: Note) {
  return {
    title: note.title,
    content: note.content,
    tags: note.tags,
    pinned: note.pinned,
    favorite: note.favorite,
    color: note.color,
    folder: note.folder,
  };
}

type NotePayload = ReturnType<typeof notePayload>;

const trimSlashes = (value: string) => value.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';

/**
 * The path a note is addressed by in a URL: the storage root plus the note's own
 * path, e.g. `/public/Notes/Readme.md`. Local storage has no such prefix, so
 * the note path alone is used.
 */
function absoluteNotePath(note: { path: string }, capabilities: NoteCapabilities | null): string {
  const root = capabilities?.driver === 'openlist' ? capabilities.root : '';
  return trimSlashes(`${root === '/' ? '' : root}${note.path}`);
}

/**
 * True when the two payloads would produce the same file. JSON.stringify is
 * enough because both sides are built by `notePayload`, so the key order is
 * identical.
 */
function samePayload(a: NotePayload | null, b: NotePayload | null): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The store is created as a vanilla store so the API object is reachable from
 * outside React (tests, hotkeys, non-component code) while `useAppStore`
 * behaves exactly like the usual zustand hook.
 */
export const appStore = createStore<AppState>((set, get) => ({
  booted: false,
  bootError: null,
  providers: null,
  user: null,
  status: null,
  authBusy: false,

  notes: [],
  tags: [],
  folders: [],
  stats: null,
  capabilities: null,
  loadingNotes: false,
  notesError: null,

  activeId: null,
  activeNote: null,
  pendingAnchor: null,
  loadingNote: false,
  saving: false,
  dirty: false,
  lastSavedAt: null,
  lastSaved: null,

  query: '',
  activeTag: null,
  activeFolder: null,
  favoriteOnly: false,
  pinnedOnly: false,
  searchScope: { ...DEFAULT_SEARCH_SCOPE },
  expandedFolders: readExpanded(),
  // Titles are what people look for: an alphabetical list is the one that can
  // be scanned, and the timestamp sorts are a click away.
  sort: (() => {
    const stored = readLocal<SortKey>(SORT_KEY, 'title');
    return SORT_KEYS.includes(stored) ? stored : 'title';
  })(),
  sortOrder: readLocal<SortOrder>(SORT_ORDER_KEY, 'asc') === 'desc' ? 'desc' : 'asc',
  selection: [],
  editorMode: readLocal<EditorMode>(MODE_KEY, 'split'),
  sidebarOpen: typeof window === 'undefined' ? true : window.innerWidth >= 1024,
  metaOpen: typeof window === 'undefined' ? true : window.innerWidth >= 1280,

  splitRatio: Number(readLocal(SPLIT_KEY, '0.5')) || 0.5,
  // Off to begin with: reading two panes that move on their own is a surprise,
  // and a note long enough to need it is a deliberate choice.
  syncScroll: readLocal<string>(SYNC_SCROLL_KEY, 'off') === 'on',
  focusMode: false,
  focusRestore: null,

  fonts: [],
  fontSelection: { sans: '', mono: '' },
  wallpaper: DEFAULT_WALLPAPER,
  wallpaperUrl: null,
  wallpaperIdentity: null,
  adminBackground: null,
  accent: null,
  scenePreview: null,
  wallpaperLoading: null,
  appearanceOpen: false,
  theme: readLocal<Theme>(THEME_KEY, 'dark'),
  trash: [],
  trashFolders: [],
  trashOpen: false,
  settingsOpen: false,
  paletteOpen: false,
  toasts: [],

  /* ------------------------------- boot -------------------------------- */
  boot: async () => {
    applyTheme(get().theme);
    // the wallpaper is a client side preference: restore it before anything else
    set({ wallpaper: loadWallpaperSettings() });
    void get().refreshWallpaperUrl();
    // The administrator's background shows before anybody signs in, so it is
    // asked for here rather than after the session is known.
    void get().refreshAdminBackground();
    try {
      const [providers, me, status] = await Promise.all([api.providers(), api.me(), api.status()]);
      set({ providers, user: me.user, status, booted: true, bootError: null });
      if (me.user) {
        await Promise.all([get().refreshNotes(), get().loadFonts()]);
        // a shared link opens straight into its note
        await get().openFromLocation();
      }
    } catch (err) {
      set({ booted: true, bootError: errorMessage(err) });
    }
  },

  login: async (input) => {
    set({ authBusy: true });
    try {
      const result = await api.login(input);
      set({ user: result.user });
      await Promise.all([get().refreshNotes(), get().refreshStatus(), get().loadFonts()]);
      await get().openFromLocation();
    } finally {
      set({ authBusy: false });
    }
  },

  guestLogin: async () => {
    set({ authBusy: true });
    try {
      const result = await api.login({ username: '', password: '', provider: 'guest' });
      set({ user: result.user });
      await Promise.all([get().refreshNotes(), get().refreshStatus(), get().loadFonts()]);
      await get().openFromLocation();
    } finally {
      set({ authBusy: false });
    }
  },

  logout: async () => {
    saveQueued = false;
    await api.logout().catch(() => undefined);
    set({
      user: null,
      notes: [],
      tags: [],
      folders: [],
      stats: null,
      activeId: null,
      activeNote: null,
      lastSaved: null,
      dirty: false,
      fonts: [],
      fontSelection: { sans: '', mono: '' },
      trash: [],
      trashOpen: false,
      settingsOpen: false,
    });
    applyFonts([], { sans: '', mono: '' });
  },

  refreshStatus: async () => {
    try {
      const status = await api.status();
      set({ status, user: status.user ?? get().user });
    } catch {
      /* non fatal */
    }
  },

  /* ------------------------------ notes -------------------------------- */
  refreshNotes: async (options) => {
    if (!get().user) return;
    if (!options?.silent) set({ loadingNotes: true });
    try {
      const payload = await api.listNotes();
      const { activeId, activeNote } = get();
      let nextActive = activeNote;
      if (activeNote) {
        const updated = payload.notes.find((n) => n.id === activeNote.id);
        if (!updated) {
          nextActive = null;
        } else if (!get().dirty) {
          nextActive = { ...activeNote, ...updated, content: activeNote.content };
        } else {
          nextActive = { ...activeNote };
        }
      }
      set({
        notes: payload.notes,
        tags: payload.tags,
        folders: payload.folders,
        stats: payload.stats,
        capabilities: payload.capabilities ?? null,
        loadingNotes: false,
        notesError: null,
        activeNote: nextActive,
        activeId: nextActive ? activeId : null,
      });
    } catch (err) {
      set({ loadingNotes: false, notesError: errorMessage(err) });
    }
  },

  selectNote: async (id, options) => {
    if (get().activeId === id && get().activeNote && !options?.anchor) return;
    await get().saveActive(true);
    set({ activeId: id, loadingNote: true, pendingAnchor: options?.anchor ?? null });
    try {
      const { note } = await api.getNote(id);
      set({
        activeNote: note,
        loadingNote: false,
        dirty: false,
        lastSavedAt: Date.parse(note.updated),
        // the baseline every later comparison is made against
        lastSaved: notePayload(note),
      });
      const target = absoluteNotePath(note, get().capabilities);
      const anchor = options?.anchor ?? null;
      if (options?.replaceHistory) replaceLocation(target, anchor);
      else pushLocation(target, anchor);
    } catch (err) {
      set({ loadingNote: false, pendingAnchor: null });
      get().pushToast({ title: '打开笔记失败', message: errorMessage(err), tone: 'error' });
    }
  },

  openFromLocation: async () => {
    // The front page is not the panel: its address names no note, and rewriting
    // it into a note URL would drag a visitor off the page they asked for.
    if (!inManager()) return;
    const { path, anchor } = readLocation();
    if (!path) {
      // the notes root: make sure a stale note is not left in the address bar
      if (get().activeNote) get().closeNote();
      return;
    }
    if (get().notes.length === 0) await get().refreshNotes({ silent: true });
    const capabilities = get().capabilities;
    const wanted = trimSlashes(path);
    const notes = get().notes;
    const found =
      notes.find((n) => trimSlashes(absoluteNotePath(n, capabilities)) === wanted) ??
      notes.find((n) => trimSlashes(n.path) === wanted);
    if (!found) {
      get().pushToast({
        title: '链接指向的笔记不存在',
        message: `${path} —— 可能已被移动或删除`,
        tone: 'error',
      });
      replaceLocation(null);
      return;
    }
    await get().selectNote(found.id, { anchor: anchor || undefined, replaceHistory: true });
  },

  openInternalLink: async (href) => {
    const state = get();
    const raw = href.startsWith('notes:') ? href.slice('notes:'.length) : href;
    let target = raw;
    try {
      target = decodeURIComponent(raw);
    } catch {
      /* keep the raw value */
    }
    target = target.split('#')[0]?.split('?')[0] ?? target;
    target = target.replace(/^\.\//, '').replace(/^\//, '');

    const notes = state.notes;
    const byId = notes.find((n) => n.id === target);
    const byPath = notes.find((n) => {
      const p = n.path.replace(/^\//, '').replace(/^\.[/\\]?/, '');
      return p === target || p.toLowerCase() === target.toLowerCase();
    });
    const byName = notes.find((n) => n.path.split('/').pop()?.toLowerCase() === target.toLowerCase());
    const byTitle = notes.find((n) => n.title.toLowerCase() === target.replace(/\.(md|markdown)$/i, '').toLowerCase());

    const found = byId ?? byPath ?? byName ?? byTitle;
    if (!found) {
      state.pushToast({
        title: '找不到链接指向的笔记',
        message: `${href} —— 该笔记可能还没同步到当前目录`,
        tone: 'error',
      });
      return;
    }
    await get().selectNote(found.id);
  },

  closeNote: () => {
    void get().saveActive(true);
    set({ activeId: null, activeNote: null, pendingAnchor: null, dirty: false, lastSaved: null });
    replaceLocation(null);
  },

  uploadFiles: async (files, folder) => {
    if (files.length === 0) return 0;

    const target = folder ?? get().activeFolder ?? undefined;
    let uploaded = 0;
    const failures: string[] = [];
    for (const file of files) {
      try {
        // Every file goes up as it is: a .md becomes a note, a picture stays a
        // picture. Nothing is renamed on the way in - the name the file has is
        // the name it keeps.
        // eslint-disable-next-line no-await-in-loop
        await api.uploadNote(file, target);
        uploaded += 1;
      } catch (err) {
        failures.push(`${file.name}: ${errorMessage(err)}`);
      }
    }

    if (uploaded > 0) await get().refreshNotes({ silent: true });
    void get().refreshMeta();

    if (failures.length > 0) {
      get().pushToast({
        title: `${uploaded} 个已上传，${failures.length} 个失败`,
        message: failures.slice(0, 3).join('；'),
        tone: 'error',
      });
    } else {
      get().pushToast({ title: `已上传 ${uploaded} 个文件`, tone: 'success' });
    }
    return uploaded;
  },

  createNote: async (input) => {
    try {
      const { note } = await api.createNote({
        title: input?.title ?? '未命名笔记',
        content: input?.content ?? '',
        folder: input?.folder ?? (get().activeFolder ?? undefined),
      });
      const summary = toSummary(note);
      set((state) => ({
        notes: [summary, ...state.notes],
        activeId: note.id,
        activeNote: note,
        dirty: false,
        lastSavedAt: Date.now(),
        lastSaved: notePayload(note),
        editorMode: state.editorMode === 'preview' ? 'split' : state.editorMode,
      }));
      void get().refreshMeta();
    } catch (err) {
      get().pushToast({ title: '创建笔记失败', message: errorMessage(err), tone: 'error' });
      throw err;
    }
  },

  patchActive: (patch, options) => {
    const current = get().activeNote;
    if (!current) return;

    const next: Note = { ...current, ...patch } as Note;

    // Compare what would actually change. Editors echo their own state (mount,
    // external sync, a caret move that re-renders) and the metadata bar fires on
    // blur, so without this check an untouched note is marked dirty and saved
    // the moment it is opened.
    const before = notePayload(current);
    const after = notePayload(next);
    if (samePayload(before, after)) return;

    // Dirty is derived, not assumed: undoing an edit back to the saved text
    // clears it again and cancels the pending save.
    const dirty = !samePayload(after, get().lastSaved);

    set((state) => ({
      activeNote: next,
      dirty,
      notes: state.notes.map((n) =>
        n.id === next.id
          ? {
              ...n,
              title: next.title,
              tags: next.tags,
              pinned: next.pinned,
              favorite: next.favorite,
              color: next.color,
              folder: next.folder,
              content: next.content,
              excerpt: stripMarkdown(next.content, 200),
              wordCount: next.content.trim() ? next.content.trim().split(/\s+/).length : 0,
            }
          : n,
      ),
    }));

    // Editing never writes by itself. A rename used to fire a request every
    // few keystrokes and the reply then overwrote the field that was still
    // being typed in, so the title appeared to roll back; now the field only
    // marks the note dirty and the save happens on blur or on Ctrl/⌘+S.
    if (options?.save === true) void get().saveActive(true);
  },

  saveActive: async (_immediate = false) => {
    const { activeNote, dirty, saving, lastSaved } = get();
    if (!activeNote) return;
    // Already writing: remember that another save is wanted and let the one in
    // flight finish, rather than dropping the request.
    if (saving) {
      saveQueued = true;
      return;
    }
    const snapshot = activeNote;
    const payload = notePayload(snapshot);

    // Nothing to do when the server already holds exactly this. Cheap to check,
    // and it keeps a stale timer (or an explicit save on blur) from writing the
    // same file again.
    if (samePayload(payload, lastSaved)) {
      if (dirty) set({ dirty: false });
      return;
    }
    if (!dirty) return;

    set({ saving: true });
    try {
      const { note } = await api.updateNote(snapshot.id, {
        title: snapshot.title,
        content: snapshot.content,
        tags: snapshot.tags,
        pinned: snapshot.pinned,
        favorite: snapshot.favorite,
        color: snapshot.color,
        folder: snapshot.folder,
      });
      // Compared against what was sent, not against the reply: renaming a file
      // changes its id (a file has no front matter to hold one), so the note
      // that comes back is the same note under a new name.
      const stillSame = get().activeNote?.id === snapshot.id;
      const current = get().activeNote;
      // Whether anything was typed while the request was in flight. The reply
      // may only replace what was sent: the note came back with the title and
      // body of the snapshot, and applying that over newer keystrokes is what
      // made a rename look like it had been rolled back.
      const untouched = stillSame && Boolean(current) && samePayload(notePayload(current as Note), payload);
      // The server normalises the file (front matter layout, trailing newline),
      // so its body can differ from what was typed. Keeping the local text and
      // recording what was sent avoids an immediate echo-edit - and a second
      // save - through the editor's value sync.
      const merged: Note = untouched
        ? { ...note, content: snapshot.content }
        : {
            ...(current as Note),
            id: note.id,
            path: note.path,
            updated: note.updated,
            size: note.size,
            hasFrontMatter: note.hasFrontMatter,
            created: note.created,
          };
      set((state) => ({
        saving: false,
        dirty: untouched ? false : !samePayload(notePayload(merged), payload),
        lastSavedAt: Date.now(),
        lastSaved: payload,
        activeNote: stillSame ? merged : state.activeNote,
        activeId: stillSame && state.activeId === snapshot.id ? note.id : state.activeId,
        notes: state.notes.map((n) => (n.id === snapshot.id ? { ...n, ...toSummary(merged) } : n)),
      }));
      // A title change renames the file, so the address of the open note moves
      // with it - the link in the address bar has to keep pointing at the note.
      if (stillSame && note.path !== snapshot.path) {
        replaceLocation(absoluteNotePath(note, get().capabilities));
      }
    } catch (err) {
      set({ saving: false });
      get().pushToast({ title: '保存失败', message: errorMessage(err), tone: 'error' });
    } finally {
      if (saveQueued) {
        saveQueued = false;
        if (get().dirty && get().activeNote) void get().saveActive(true);
      }
    }
  },

  deleteNote: async (id, options) => {
    const previous = get().notes.find((n) => n.id === id);
    const wasActive = get().activeId === id;
    try {
      const result = await api.deleteNote(id, options?.permanent);
      // A file has no front matter to carry an id, so its id is derived from
      // where it lies - and that changes the moment it lands in the trash.
      const trashedId = result.id ?? id;
      set((state) => ({
        notes: state.notes.filter((n) => n.id !== id),
        activeId: wasActive ? null : state.activeId,
        activeNote: wasActive ? null : state.activeNote,
      }));
      if (options?.permanent) {
        set((state) => ({ trash: state.trash.filter((n) => n.id !== id) }));
        get().pushToast({ title: '已永久删除', tone: 'info' });
      } else {
        get().pushToast({
          title: '已移入回收站',
          message: previous?.title,
          tone: 'info',
          action: { label: '撤销', run: () => get().restoreNote(trashedId) },
        });
      }
      void get().refreshMeta();
    } catch (err) {
      get().pushToast({ title: '删除失败', message: errorMessage(err), tone: 'error' });
    }
  },

  restoreNote: async (id) => {
    try {
      const { note } = await api.restoreNote(id);
      set((state) => ({ trash: state.trash.filter((n) => n.id !== id) }));
      await get().refreshNotes({ silent: true });
      get().pushToast({ title: '已恢复', message: note.title, tone: 'success' });
    } catch (err) {
      get().pushToast({ title: '恢复失败', message: errorMessage(err), tone: 'error' });
    }
  },

  loadTrash: async () => {
    try {
      const { notes, folders } = await api.listTrash();
      set({ trash: notes, trashFolders: folders ?? [] });
    } catch (err) {
      get().pushToast({ title: '无法加载回收站', message: errorMessage(err), tone: 'error' });
    }
  },

  emptyTrash: async () => {
    try {
      const result = await api.emptyTrash();
      set({ trash: [], trashFolders: [] });
      get().pushToast({ title: '回收站已清空', message: `删除 ${result.removed} 个文件`, tone: 'success' });
    } catch (err) {
      get().pushToast({ title: '清空失败', message: errorMessage(err), tone: 'error' });
    }
  },

  togglePinned: async (id) => {
    const note = get().notes.find((n) => n.id === id);
    if (!note) return;
    const next = !note.pinned;
    set((state) => ({
      notes: state.notes.map((n) => (n.id === id ? { ...n, pinned: next } : n)),
      activeNote: state.activeNote?.id === id ? { ...state.activeNote, pinned: next } : state.activeNote,
    }));
    try {
      await api.updateNote(id, { pinned: next });
      await get().refreshNotes({ silent: true });
    } catch (err) {
      set((state) => ({ notes: state.notes.map((n) => (n.id === id ? { ...n, pinned: !next } : n)) }));
      get().pushToast({ title: '操作失败', message: errorMessage(err), tone: 'error' });
    }
  },

  toggleFavorite: async (id) => {
    const note = get().notes.find((n) => n.id === id) ?? (get().activeNote?.id === id ? get().activeNote : null);
    if (!note) return;
    const next = !note.favorite;
    set((state) => ({
      notes: state.notes.map((n) => (n.id === id ? { ...n, favorite: next } : n)),
      activeNote: state.activeNote?.id === id ? { ...state.activeNote, favorite: next } : state.activeNote,
    }));
    try {
      await api.updateNote(id, { favorite: next });
    } catch (err) {
      set((state) => ({ notes: state.notes.map((n) => (n.id === id ? { ...n, favorite: !next } : n)) }));
      get().pushToast({ title: '操作失败', message: errorMessage(err), tone: 'error' });
    }
  },

  setColor: async (id, color) => {
    set((state) => ({
      notes: state.notes.map((n) => (n.id === id ? { ...n, color } : n)),
      activeNote: state.activeNote?.id === id ? { ...state.activeNote, color } : state.activeNote,
    }));
    try {
      await api.updateNote(id, { color });
    } catch (err) {
      get().pushToast({ title: '设置颜色失败', message: errorMessage(err), tone: 'error' });
    }
  },

  /** Resolves the background layer's URL: a remote one, or a blob for a local file. */
  refreshAdminBackground: async () => {
    try {
      const payload = await api.background();
      set({
        adminBackground: {
          configured: payload.configured,
          kind: payload.kind,
          // Named, so it is a URL at a file rather than at "whatever is
          // configured"; versioned by the file's hash, so it is a URL at one
          // version of it that the browser may keep; and built from the API root
          // so a deployment under a sub path asks the right server.
          url: payload.configured && payload.file ? backgroundFileUrl(payload.file, payload.hash) : '',
          note: payload.note,
          file: payload.file,
          bytes: payload.bytes,
          hash: payload.hash,
          options: payload.options,
          available: payload.available,
        },
      });
    } catch {
      // Nothing configured, or the server is unreachable. Either way the user's
      // own wallpaper is the answer.
      set({ adminBackground: null });
    }
  },

  refreshWallpaperUrl: async () => {
    const settings = get().wallpaper;
    const previous = get().wallpaperUrl;
    const dropPrevious = () => {
      if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous);
    };
    if (settings.kind === 'none') {
      dropPrevious();
      set({ wallpaperUrl: null, wallpaperIdentity: null });
      return;
    }
    if (settings.source === 'url') {
      const url = settings.url.trim();
      if (previous === (url || null)) return;
      dropPrevious();
      set({ wallpaperUrl: url || null, wallpaperIdentity: url || null });
      return;
    }
    const blob = await loadWallpaperFile();
    const identity = blob ? fileIdentity(blob) : null;
    // The same file is already what is on screen. Handing the layer a fresh
    // blob URL for it would only make it throw away its renderer and build the
    // whole background again - and for a scene that is a 45 MB parse, every
    // time. Choosing the same file from a different source tab is not a change.
    if (identity && identity === get().wallpaperIdentity && previous?.startsWith('blob:')) return;
    dropPrevious();
    set({ wallpaperUrl: blob ? URL.createObjectURL(blob) : null, wallpaperIdentity: identity });
  },

  refreshProviders: async () => {
    try {
      set({ providers: await api.providers() });
    } catch {
      /* the sign-in screen asks again when it is shown */
    }
  },

  refreshMeta: async () => {
    try {
      const payload = await api.listNotes();
      set({ tags: payload.tags, folders: payload.folders, stats: payload.stats, notes: payload.notes });
    } catch {
      /* ignore */
    }
  },

  createFolder: async (path) => {
    try {
      const result = await api.createFolder(path);
      set({ folders: result.folders });
      get().pushToast({ title: '文件夹已创建', message: result.folder, tone: 'success' });
    } catch (err) {
      get().pushToast({ title: '创建文件夹失败', message: errorMessage(err), tone: 'error' });
    }
  },

  renameFolder: async (path, name) => {
    try {
      const result = await api.renameFolder(path, name);
      set({ folders: result.folders });
      // The old path is gone, so anything pointing at it has to follow.
      const state = get();
      if (state.activeFolder === path) set({ activeFolder: result.path });
      else if (state.activeFolder?.startsWith(`${path}/`)) {
        set({ activeFolder: `${result.path}${state.activeFolder.slice(path.length)}` });
      }
      await get().refreshNotes({ silent: true });
      get().pushToast({ title: '文件夹已重命名', message: result.path, tone: 'success' });
    } catch (err) {
      get().pushToast({ title: '重命名失败', message: errorMessage(err), tone: 'error' });
    }
  },

  renameNote: async (id, title) => {
    const next = title.trim();
    if (!next) return;
    try {
      // The server renames the file to match, so the note comes back with a new
      // path - and the address bar has to follow, or the link would point at a
      // file that no longer exists.
      const { note } = await api.updateNote(id, { title: next });
      const summary = toSummary(note);
      const isActive = get().activeId === id;
      set((state) => ({
        notes: state.notes.map((n) => (n.id === id ? summary : n)),
        // Unsaved edits stay on screen: the reply carries the file as it was
        // before them.
        activeNote:
          state.activeNote?.id === id ? { ...note, content: state.activeNote.content } : state.activeNote,
        // A file's id is derived from its path, so renaming it re-addresses it:
        // whatever pointed at the old id has to point at the new one.
        activeId: isActive ? note.id : state.activeId,
        lastSaved: isActive && !state.dirty ? notePayload(note) : state.lastSaved,
      }));
      if (isActive) replaceLocation(absoluteNotePath(note, get().capabilities));
      get().pushToast({ title: '笔记已重命名', message: next, tone: 'success' });
    } catch (err) {
      get().pushToast({ title: '重命名失败', message: errorMessage(err), tone: 'error' });
    }
  },

  moveNote: async (id, folder) => {
    try {
      const { note } = await api.updateNote(id, { folder });
      const summary = toSummary(note);
      const wasActive = get().activeId === id;
      set((state) => ({
        notes: state.notes.map((n) => (n.id === id ? summary : n)),
        activeNote: state.activeNote?.id === id ? { ...note, content: state.activeNote.content } : state.activeNote,
        // Moving a file re-addresses it too, so the open note follows.
        activeId: wasActive ? note.id : state.activeId,
      }));
      if (wasActive) replaceLocation(absoluteNotePath(note, get().capabilities));
      await get().refreshMeta();
      get().pushToast({ title: '笔记已移动', message: folder || '根目录', tone: 'success' });
    } catch (err) {
      get().pushToast({ title: '移动失败', message: errorMessage(err), tone: 'error' });
    }
  },

  setPublish: async (id, patch) => {
    try {
      const current =
        get().notes.find((n) => n.id === id) ?? (get().activeNote?.id === id ? get().activeNote : null);
      const title = patch.title.trim();
      const { note } = await api.updateNote(id, {
        blog: patch.published,
        // An empty box means "no override": the card falls back to the note's
        // own title. So does a title that already says the same thing - storing
        // it would freeze the card against a later rename of the note.
        blogTitle: title && current && title !== current.title ? title : '',
        blogSummary: patch.summary.trim(),
      });
      const summary = toSummary(note);
      set((state) => ({
        notes: state.notes.map((n) => (n.id === id ? summary : n)),
        activeNote: state.activeNote?.id === id ? { ...note, content: state.activeNote.content } : state.activeNote,
      }));
      void get().refreshMeta();
      get().pushToast({
        title: patch.published ? '已发布到博客' : '已取消发布',
        message: note.blogTitle || note.title,
        tone: 'success',
      });
    } catch (err) {
      get().pushToast({ title: '保存发布信息失败', message: errorMessage(err), tone: 'error' });
      throw err;
    }
  },

  forgetPublish: async (id) => {
    try {
      const { note } = await api.clearPublish(id);
      const summary = toSummary(note);
      set((state) => ({
        notes: state.notes.map((n) => (n.id === id ? summary : n)),
        activeNote: state.activeNote?.id === id ? { ...note, content: state.activeNote.content } : state.activeNote,
      }));
      void get().refreshMeta();
      get().pushToast({ title: '已删除发布信息', message: note.title, tone: 'info' });
    } catch (err) {
      get().pushToast({ title: '删除发布信息失败', message: errorMessage(err), tone: 'error' });
      throw err;
    }
  },

  moveNotes: async (ids, folder) => {
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) return;
    const target = folder.replace(/^\/+|\/+$/g, '');
    const moved: string[] = [];
    const failures: string[] = [];
    for (const id of wanted) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await api.updateNote(id, { folder: target });
        moved.push(id);
      } catch (err) {
        failures.push(errorMessage(err));
      }
    }
    if (moved.length > 0) await get().refreshNotes({ silent: true });
    set({ selection: [] });
    get().pushToast({
      title: `已移动 ${moved.length} 篇笔记`,
      message: failures.length > 0 ? `${failures.length} 篇失败：${failures.slice(0, 2).join('；')}` : target || '根目录',
      tone: failures.length > 0 ? 'error' : 'success',
    });
  },

  moveSelection: async (folder) => {
    const entries = get().selection;
    if (entries.length === 0) return;
    const target = folder.replace(/^\/+|\/+$/g, '');
    const notes = entries.filter((e) => e.kind === 'note').map((e) => e.id);
    const folders = entries
      .filter((e) => e.kind === 'folder')
      .map((e) => e.id)
      // A folder cannot be moved inside itself or into what is already below it.
      .filter((path) => target !== path && !target.startsWith(`${path}/`));
    let moved = notes.length;
    const failures: string[] = [];
    for (const id of notes) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await api.updateNote(id, { folder: target });
      } catch (err) {
        moved -= 1;
        failures.push(errorMessage(err));
      }
    }
    for (const path of folders) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await api.moveFolder(path, target);
        moved += 1;
      } catch (err) {
        failures.push(errorMessage(err));
      }
    }
    await get().refreshNotes({ silent: true });
    set({ selection: [] });
    get().pushToast({
      title: `已移动 ${moved} 项`,
      message: failures.length > 0 ? `${failures.length} 项失败：${failures.slice(0, 2).join('；')}` : target || '根目录',
      tone: failures.length > 0 ? 'error' : 'success',
    });
  },

  downloadSelection: async () => {
    const entries = get().selection.filter((e) => e.kind === 'note');
    if (entries.length === 0) {
      get().pushToast({ title: '没有可下载的文件', message: '文件夹不能下载', tone: 'info' });
      return;
    }
    // One click per file, spaced out: a browser asked for ten downloads at once
    // treats them as a pop-up storm and drops most of them.
    for (const entry of entries) {
      const anchor = document.createElement('a');
      anchor.href = noteDownloadUrl(entry.id);
      anchor.download = '';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    get().pushToast({
      title: `已开始下载 ${entries.length} 个文件`,
      message: entries.length > 3 ? '浏览器可能询问是否允许批量下载' : undefined,
      tone: 'success',
    });
  },

  deleteSelection: async () => {
    const entries = get().selection;
    if (entries.length === 0) return;
    const notes = entries.filter((e) => e.kind === 'note').map((e) => e.id);
    const folders = entries.filter((e) => e.kind === 'folder').map((e) => e.id);
    const removedNotes: string[] = [];
    const failures: string[] = [];
    for (const id of notes) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await api.deleteNote(id);
        removedNotes.push(id);
      } catch (err) {
        failures.push(errorMessage(err));
      }
    }
    for (const path of folders) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await api.deleteFolder(path);
      } catch (err) {
        failures.push(errorMessage(err));
      }
    }
    set((state) => ({
      notes: state.notes.filter((n) => !removedNotes.includes(n.id)),
      activeId: state.activeId && removedNotes.includes(state.activeId) ? null : state.activeId,
      activeNote: state.activeNote && removedNotes.includes(state.activeNote.id) ? null : state.activeNote,
      selection: [],
    }));
    await get().refreshMeta();
    get().pushToast({
      title: `已移入回收站 ${entries.length} 项`,
      message: failures.length > 0 ? `${failures.length} 项失败：${failures.slice(0, 2).join('；')}` : '可在回收站里恢复',
      tone: failures.length > 0 ? 'error' : 'info',
      action: { label: '撤销', run: () => get().restoreSelection(removedNotes, folders) },
    });
  },

  restoreSelection: async (notes, folders) => {
    for (const id of notes) {
      // eslint-disable-next-line no-await-in-loop
      await api.restoreNote(id).catch(() => undefined);
    }
    for (const path of folders) {
      // eslint-disable-next-line no-await-in-loop
      await api.restoreTrashFolder(path).catch(() => undefined);
    }
    await get().refreshNotes({ silent: true });
    get().pushToast({ title: `已恢复 ${notes.length + folders.length} 项`, tone: 'success' });
  },

  moveFolder: async (path, target) => {
    try {
      const clean = target.replace(/^\/+|\/+$/g, '');
      const result = await api.moveFolder(path, clean);
      await get().refreshNotes({ silent: true });
      // Whatever was pointed at the old path now points at the new one.
      const state = get();
      if (state.activeFolder === path) set({ activeFolder: result.path });
      else if (state.activeFolder?.startsWith(`${path}/`)) {
        set({ activeFolder: `${result.path}${state.activeFolder.slice(path.length)}` });
      }
      get().pushToast({
        title: '文件夹已移动',
        message: `${path} → ${clean || '根目录'}`,
        tone: 'success',
      });
    } catch (err) {
      get().pushToast({ title: '移动文件夹失败', message: errorMessage(err), tone: 'error' });
    }
  },

  deleteFolder: async (path) => {
    try {
      const result = await api.deleteFolder(path);
      set({ folders: result.folders });
      if (get().activeFolder === path) set({ activeFolder: null });
      await get().refreshNotes({ silent: true });
      get().pushToast({
        title: '文件夹已移入回收站',
        message: `${path} · 可在回收站里恢复`,
        tone: 'success',
      });
    } catch (err) {
      get().pushToast({ title: '删除文件夹失败', message: errorMessage(err), tone: 'error' });
    }
  },

  /* -------------------------------- ui --------------------------------- */
  setPendingAnchor: (anchor) => set({ pendingAnchor: anchor }),

  /* ------------------------------ appearance ------------------------------- */
  loadFonts: async () => {
    try {
      const { fonts, selection } = await api.fonts();
      applyFonts(fonts, selection);
      set({ fonts, fontSelection: selection });
    } catch {
      /* not signed in yet, or the endpoint is unavailable */
    }
  },

  uploadFont: async (file, name) => {
    const result = await api.uploadFont(file, name);
    applyFonts(result.fonts, result.selection);
    set({ fonts: result.fonts, fontSelection: result.selection });
    get().pushToast({ title: '字体已导入', message: result.font.name, tone: 'success' });
  },

  deleteFont: async (id) => {
    const result = await api.deleteFont(id);
    applyFonts(result.fonts, result.selection);
    set({ fonts: result.fonts, fontSelection: result.selection });
    get().pushToast({ title: '字体已删除', tone: 'info' });
  },

  selectFonts: async (selection) => {
    const result = await api.selectFonts(selection);
    applyFonts(result.fonts, result.selection);
    set({ fonts: result.fonts, fontSelection: result.selection });
  },

  setAccent: (colour) => {
    if (get().accent !== colour) set({ accent: colour });
  },

  setScenePreview: (preview) => {
    if (get().scenePreview !== preview) set({ scenePreview: preview });
  },

  setWallpaperLoading: (state) => set({ wallpaperLoading: state }),

  setWallpaper: (patch) => {
    const before = get().wallpaper;
    const next = { ...before, ...patch };
    saveWallpaperSettings(next);
    set({ wallpaper: next });

    // Only the fields that decide *what* is on screen need the url rebuilt.
    // Refreshing it for every change - and the crop editor changes on every
    // drag - revoked the blob and made a new one, so an image reloaded and a
    // video restarted from zero with its aspect ratio briefly unknown, which
    // is what made the crop frame jump while the selection was being dragged.
    const reloads =
      before.kind !== next.kind || before.source !== next.source || before.url !== next.url;
    if (reloads) void get().refreshWallpaperUrl();
  },

  setWallpaperFile: async (file, source = 'file', explicitKind) => {
    await saveWallpaperFile(file);
    // the extension is the better signal: a picked .webm often has no MIME type
    const kind =
      explicitKind ?? wallpaperKindOf(file.name) ?? (file.type.startsWith('video/') ? 'video' : 'image');
    const next: WallpaperSettings = { ...get().wallpaper, kind, source };
    saveWallpaperSettings(next);
    set({ wallpaper: next });
    await get().refreshWallpaperUrl();
    get().pushToast({ title: '壁纸已更新', message: file.name, tone: 'success' });
  },

  /**
   * Back to the defaults: no wallpaper of the user's own, nothing stored.
   *
   * The administrator-background switch is deliberately not part of that. It
   * says *whose* background wins rather than which one, so resetting the
   * wallpaper used to turn it back on behind the user's back - and with the
   * administrator's background configured, the picture they had just chosen
   * never appeared.
   */
  clearWallpaper: async () => {
    await clearWallpaperFile();
    const next: WallpaperSettings = {
      ...DEFAULT_WALLPAPER,
      useAdminBackground: get().wallpaper.useAdminBackground,
    };
    saveWallpaperSettings(next);
    set({ wallpaper: next, wallpaperUrl: null, wallpaperIdentity: null });
  },

  setAppearanceOpen: (value) => set({ appearanceOpen: value }),
  setQuery: (value) => set({ query: value }),
  setActiveTag: (tag) => set({ activeTag: tag }),
  setActiveFolder: (folder) => set({ activeFolder: folder }),
  setFavoriteOnly: (value) => set({ favoriteOnly: value }),
  setPinnedOnly: (value) => set({ pinnedOnly: value }),

  setExpandedFolders: (paths) => {
    // The tree recalculates this on every render; only a real change should
    // reach the store, or the effect that opens a folder would loop.
    const current = get().expandedFolders;
    if (current.length === paths.length && current.every((p, i) => p === paths[i])) return;
    writeExpanded(paths);
    set({ expandedFolders: paths });
  },
  setSearchScope: (scope) => set({ searchScope: scope }),
  setSort: (sort) => {
    writeLocal(SORT_KEY, sort);
    set({ sort });
  },
  setSortOrder: (order) => {
    writeLocal(SORT_ORDER_KEY, order);
    set({ sortOrder: order });
  },
  setSelection: (entries) => set({ selection: entries }),
  toggleSelection: (entry) =>
    set((state) => {
      const exists = state.selection.some((e) => e.kind === entry.kind && e.id === entry.id);
      return {
        selection: exists
          ? state.selection.filter((e) => !(e.kind === entry.kind && e.id === entry.id))
          : [...state.selection, entry],
      };
    }),
  clearSelection: () => set({ selection: [] }),
  setEditorMode: (mode) => {
    writeLocal(MODE_KEY, mode);
    set({ editorMode: mode });
  },
  toggleSidebar: (value) => set((state) => ({ sidebarOpen: value ?? !state.sidebarOpen })),
  toggleMeta: (value) => set((state) => ({ metaOpen: value ?? !state.metaOpen })),

  toggleFocusMode: (value) =>
    set((state) => {
      const next = value ?? !state.focusMode;
      if (next === state.focusMode) return {};
      if (next) {
        return {
          focusMode: true,
          focusRestore: { sidebarOpen: state.sidebarOpen, metaOpen: state.metaOpen },
          sidebarOpen: false,
          metaOpen: false,
        };
      }
      return {
        focusMode: false,
        sidebarOpen: state.focusRestore?.sidebarOpen ?? state.sidebarOpen,
        metaOpen: state.focusRestore?.metaOpen ?? state.metaOpen,
        focusRestore: null,
      };
    }),
  toggleSyncScroll: (value) =>
    set((state) => {
      const next = value ?? !state.syncScroll;
      writeLocal(SYNC_SCROLL_KEY, next ? 'on' : 'off');
      return { syncScroll: next };
    }),
  setSplitRatio: (value) => {
    const clamped = Math.min(0.8, Math.max(0.2, value));
    writeLocal(SPLIT_KEY, String(clamped));
    set({ splitRatio: clamped });
  },
  setTheme: (theme) => {
    writeLocal(THEME_KEY, theme);
    applyTheme(theme);
    set({ theme });
  },
  restoreTrashFolder: async (path) => {
    try {
      await api.restoreTrashFolder(path);
      set((state) => ({ trashFolders: state.trashFolders.filter((f) => f.path !== path) }));
      await get().refreshMeta();
      await get().refreshNotes({ silent: true });
      get().pushToast({ title: '文件夹已恢复', message: path, tone: 'success' });
    } catch (err) {
      get().pushToast({ title: '恢复文件夹失败', message: errorMessage(err), tone: 'error' });
    }
  },

  deleteTrashFolder: async (path) => {
    try {
      await api.deleteTrashFolder(path);
      set((state) => ({ trashFolders: state.trashFolders.filter((f) => f.path !== path) }));
      get().pushToast({ title: '文件夹已彻底删除', message: path, tone: 'success' });
    } catch (err) {
      get().pushToast({ title: '删除失败', message: errorMessage(err), tone: 'error' });
    }
  },

  setTrashOpen: (value) => {
    set({ trashOpen: value });
    if (value) void get().loadTrash();
  },
  setSettingsOpen: (value) => set({ settingsOpen: value }),
  setPaletteOpen: (value) => set({ paletteOpen: value }),

  pushToast: (toast) => {
    const item: Toast = {
      id: toast.id ?? Math.random().toString(36).slice(2),
      createdAt: Date.now(),
      ...toast,
    };
    set((state) => ({ toasts: [...state.toasts.slice(-3), item] }));
    const duration = toast.tone === 'error' ? 7000 : 4200;
    setTimeout(() => get().dismissToast(item.id), duration);
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

const useAppStoreBase = <T,>(selector: (state: AppState) => T): T => useStore(appStore, selector);

/** zustand hook with the vanilla store API attached (`getState`, `setState`, …). */
export const useAppStore = Object.assign(useAppStoreBase, appStore);

/**
 * Whether the current account may modify the notes folder.
 *
 * The backend's own answer (OpenList reports `write` with every listing) wins;
 * the account's permission bits are the fallback, and while nothing is known yet
 * the UI stays optimistic - the server enforces the rule either way.
 */
export function useCanWrite(): boolean {
  return useAppStore((s) => {
    if (s.capabilities) return s.capabilities.writable;
    if (s.user?.permissions) return s.user.permissions.write && s.user.permissions.remove;
    return true;
  });
}

/** Why the account is read-only, for the banner. */
export function useReadOnlyReason(): string | null {
  const canWrite = useCanWrite();
  const capabilities = useAppStore((s) => s.capabilities);
  const user = useAppStore((s) => s.user);
  if (canWrite) return null;

  const reasons: string[] = [];
  if (user?.permissions && !user.permissions.write) {
    reasons.push(user.guest || user.openlistGuest ? '游客账号没有写入权限' : '当前 OpenList 账号没有写入权限');
  }
  if (capabilities && !capabilities.writable) {
    reasons.push(`OpenList 报告 ${capabilities.root} 不可写`);
  }
  return reasons.length ? reasons.join('，且') : '当前账号没有写入权限';
}