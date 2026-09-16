import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { api } from '../lib/api';
import { stripMarkdown } from '../lib/markdown';
import { pushLocation, readLocation, replaceLocation } from '../lib/url';
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
/**
 * How the note list is arranged. `tree` is the only one that shows folders:
 * the other two are flat lists of notes, because a card grid with folders
 * mixed in reads as neither.
 */
export type ViewMode = 'tree' | 'list' | 'grid';

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
  view: ViewMode;
  editorMode: EditorMode;
  sidebarOpen: boolean;
  /** Outline pane on the right of the editor. */
  metaOpen: boolean;
  /** Collapsible navigation block inside the merged left column. */

  /** Editor/preview split, 0.2 - 0.8. */
  splitRatio: number;
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
  adminBackground: {
    configured: boolean;
    kind: 'image' | 'scene' | null;
    url: string;
    note: string | null;
  } | null;
  refreshAdminBackground: () => Promise<void>;
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
  setWallpaper: (patch: Partial<WallpaperSettings>) => void;
  setWallpaperFile: (file: File, source?: WallpaperSource, kind?: WallpaperKind) => Promise<void>;
  clearWallpaper: () => Promise<void>;
  appearanceOpen: boolean;
  setAppearanceOpen: (value: boolean) => void;
  closeNote: () => void;
  createNote: (input?: { title?: string; folder?: string; content?: string }) => Promise<void>;
  /** Creates one note per uploaded .md file. Returns how many were accepted. */
  uploadNotes: (files: File[], folder?: string) => Promise<number>;
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
  renameNote: (id: string, title: string) => Promise<void>;

  setQuery: (value: string) => void;
  setActiveTag: (tag: string | null) => void;
  setActiveFolder: (folder: string | null) => void;
  setFavoriteOnly: (value: boolean) => void;
  setSort: (sort: SortKey) => void;
  setView: (view: ViewMode) => void;
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
const VIEW_KEY = 'notes-manager-view';
const EXPANDED_KEY = 'notes-manager-expanded-folders';
const MODE_KEY = 'notes-manager-editor-mode';
const SPLIT_KEY = 'notes-manager-split-ratio';

let saveTimer: ReturnType<typeof setTimeout> | null = null;

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
  sort: 'updated',
  // A stored 'compact' predates the tree view; fall back rather than render
  // a mode that no longer exists.
  view: (() => {
    const stored = readLocal<ViewMode>(VIEW_KEY, 'list');
    return stored === 'tree' || stored === 'list' || stored === 'grid' ? stored : 'list';
  })(),
  editorMode: readLocal<EditorMode>(MODE_KEY, 'split'),
  sidebarOpen: typeof window === 'undefined' ? true : window.innerWidth >= 1024,
  metaOpen: typeof window === 'undefined' ? true : window.innerWidth >= 1280,

  splitRatio: Number(readLocal(SPLIT_KEY, '0.5')) || 0.5,
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
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
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

  uploadNotes: async (files, folder) => {
    // Only note files. A zip or an image would come back as a note containing
    // binary noise, which is worse than refusing it.
    const accepted = files.filter((file) => /\.(md|markdown|txt)$/i.test(file.name));
    const rejected = files.length - accepted.length;
    if (accepted.length === 0) {
      get().pushToast({ title: '没有可上传的笔记', message: '只支持 .md / .markdown / .txt 文件', tone: 'error' });
      return 0;
    }

    const target = folder ?? get().activeFolder ?? undefined;
    let uploaded = 0;
    const failures: string[] = [];
    for (const file of accepted) {
      try {
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
        title: `${uploaded} 篇已上传，${failures.length} 篇失败`,
        message: failures.slice(0, 3).join('；'),
        tone: 'error',
      });
    } else {
      get().pushToast({
        title: `已上传 ${uploaded} 篇笔记`,
        message: rejected > 0 ? `另有 ${rejected} 个文件不是笔记，已跳过` : undefined,
        tone: 'success',
      });
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

    if (options?.save === false) return;
    if (saveTimer) clearTimeout(saveTimer);
    if (!dirty) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void get().saveActive(true);
    }, 900);
  },

  saveActive: async (immediate = false) => {
    const { activeNote, dirty, saving, lastSaved } = get();
    if (!activeNote || saving) return;
    if (saveTimer && immediate) {
      clearTimeout(saveTimer);
      saveTimer = null;
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
      const stillSame = get().activeNote?.id === note.id;
      const sameContent = get().activeNote?.content === snapshot.content;
      // The server normalises the file (front matter layout, trailing newline),
      // so its body can differ from what was typed. Keeping the local text and
      // recording what was sent avoids an immediate echo-edit - and a second
      // save - through the editor's value sync.
      set((state) => ({
        saving: false,
        dirty: stillSame ? !sameContent : state.dirty,
        lastSavedAt: Date.now(),
        lastSaved: payload,
        activeNote: stillSame && sameContent ? { ...note, content: snapshot.content } : state.activeNote,
        notes: state.notes.map((n) => (n.id === note.id ? { ...n, ...toSummary(note) } : n)),
      }));
    } catch (err) {
      set({ saving: false });
      get().pushToast({ title: '保存失败', message: errorMessage(err), tone: 'error' });
    }
  },

  deleteNote: async (id, options) => {
    const previous = get().notes.find((n) => n.id === id);
    const wasActive = get().activeId === id;
    try {
      await api.deleteNote(id, options?.permanent);
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
          action: { label: '撤销', run: () => get().restoreNote(id) },
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
          // Cache-busted per file name: an administrator replacing the file
          // should not have to wonder why nobody sees the new one.
          url: payload.configured ? `/api/background/file?v=${encodeURIComponent(payload.file ?? '')}` : '',
          note: payload.note,
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
    if (previous?.startsWith('blob:')) URL.revokeObjectURL(previous);
    if (settings.kind === 'none') {
      set({ wallpaperUrl: null, wallpaperIdentity: null });
      return;
    }
    if (settings.source === 'url') {
      const url = settings.url.trim();
      set({ wallpaperUrl: url || null, wallpaperIdentity: url || null });
      return;
    }
    const blob = await loadWallpaperFile();
    set({
      wallpaperUrl: blob ? URL.createObjectURL(blob) : null,
      wallpaperIdentity: blob ? fileIdentity(blob) : null,
    });
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
      const { note } = await api.updateNote(id, { title: next });
      const summary = toSummary(note);
      set((state) => ({
        notes: state.notes.map((n) => (n.id === id ? summary : n)),
        activeNote: state.activeNote?.id === id ? note : state.activeNote,
      }));
      get().pushToast({ title: '笔记已重命名', message: next, tone: 'success' });
    } catch (err) {
      get().pushToast({ title: '重命名失败', message: errorMessage(err), tone: 'error' });
    }
  },

  moveNote: async (id, folder) => {
    try {
      const { note } = await api.updateNote(id, { folder });
      const summary = toSummary(note);
      set((state) => ({
        notes: state.notes.map((n) => (n.id === id ? summary : n)),
        activeNote: state.activeNote?.id === id ? note : state.activeNote,
      }));
      await get().refreshMeta();
      get().pushToast({ title: '笔记已移动', message: folder || '根目录', tone: 'success' });
    } catch (err) {
      get().pushToast({ title: '移动失败', message: errorMessage(err), tone: 'error' });
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

  clearWallpaper: async () => {
    await clearWallpaperFile();
    const next: WallpaperSettings = { ...DEFAULT_WALLPAPER };
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
  setSort: (sort) => set({ sort }),
  setView: (view) => {
    writeLocal(VIEW_KEY, view);
    set({ view });
  },
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
    reasons.push(user.openlistGuest ? '游客账号没有写入权限' : '当前 OpenList 账号没有写入权限');
  }
  if (capabilities && !capabilities.writable) {
    reasons.push(`OpenList 报告 ${capabilities.root} 不可写`);
  }
  return reasons.length ? reasons.join('，且') : '当前账号没有写入权限';
}