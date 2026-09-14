import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { api } from '../lib/api';
import { stripMarkdown } from '../lib/markdown';
import { ApiError } from '../lib/types';
import type {
  AuthProviders,
  FolderCount,
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
export type ViewMode = 'list' | 'grid' | 'compact';
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
  sort: SortKey;
  view: ViewMode;
  editorMode: EditorMode;
  sidebarOpen: boolean;
  /** Outline pane on the right of the editor. */
  metaOpen: boolean;
  /** Collapsible navigation block inside the merged left column. */
  navOpen: boolean;
  /** Editor/preview split, 0.2 - 0.8. */
  splitRatio: number;
  /** Focus mode hides the note list and every toolbar above the note. */
  focusMode: boolean;
  /** Panes to restore when leaving focus mode. */
  focusRestore: { sidebarOpen: boolean; metaOpen: boolean } | null;
  theme: Theme;
  trash: NoteSummary[];
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
  selectNote: (id: string) => Promise<void>;
  /** Follow a link inside a note: another note opens in the panel. */
  openInternalLink: (href: string) => Promise<void>;
  closeNote: () => void;
  createNote: (input?: { title?: string; folder?: string; content?: string }) => Promise<void>;
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
  createFolder: (path: string) => Promise<void>;
  deleteFolder: (path: string) => Promise<void>;

  setQuery: (value: string) => void;
  setActiveTag: (tag: string | null) => void;
  setActiveFolder: (folder: string | null) => void;
  setFavoriteOnly: (value: boolean) => void;
  setSort: (sort: SortKey) => void;
  setView: (view: ViewMode) => void;
  setEditorMode: (mode: EditorMode) => void;
  toggleSidebar: (value?: boolean) => void;
  toggleMeta: (value?: boolean) => void;
  toggleNav: (value?: boolean) => void;
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
  loadingNote: false,
  saving: false,
  dirty: false,
  lastSavedAt: null,
  lastSaved: null,

  query: '',
  activeTag: null,
  activeFolder: null,
  favoriteOnly: false,
  sort: 'updated',
  view: readLocal<ViewMode>(VIEW_KEY, 'list'),
  editorMode: readLocal<EditorMode>(MODE_KEY, 'split'),
  sidebarOpen: typeof window === 'undefined' ? true : window.innerWidth >= 1024,
  metaOpen: typeof window === 'undefined' ? true : window.innerWidth >= 1280,
  navOpen: false,
  splitRatio: Number(readLocal(SPLIT_KEY, '0.5')) || 0.5,
  focusMode: false,
  focusRestore: null,
  theme: readLocal<Theme>(THEME_KEY, 'dark'),
  trash: [],
  trashOpen: false,
  settingsOpen: false,
  paletteOpen: false,
  toasts: [],

  /* ------------------------------- boot -------------------------------- */
  boot: async () => {
    applyTheme(get().theme);
    try {
      const [providers, me, status] = await Promise.all([api.providers(), api.me(), api.status()]);
      set({ providers, user: me.user, status, booted: true, bootError: null });
      if (me.user) await get().refreshNotes();
    } catch (err) {
      set({ booted: true, bootError: errorMessage(err) });
    }
  },

  login: async (input) => {
    set({ authBusy: true });
    try {
      const result = await api.login(input);
      set({ user: result.user });
      await Promise.all([get().refreshNotes(), get().refreshStatus()]);
    } finally {
      set({ authBusy: false });
    }
  },

  guestLogin: async () => {
    set({ authBusy: true });
    try {
      const result = await api.login({ username: '', password: '', provider: 'guest' });
      set({ user: result.user });
      await Promise.all([get().refreshNotes(), get().refreshStatus()]);
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
      trash: [],
      trashOpen: false,
      settingsOpen: false,
    });
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

  selectNote: async (id) => {
    if (get().activeId === id && get().activeNote) return;
    await get().saveActive(true);
    set({ activeId: id, loadingNote: true });
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
    } catch (err) {
      set({ loadingNote: false });
      get().pushToast({ title: '打开笔记失败', message: errorMessage(err), tone: 'error' });
    }
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
    set({ activeId: null, activeNote: null, dirty: false, lastSaved: null });
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
      const { notes } = await api.listTrash();
      set({ trash: notes });
    } catch (err) {
      get().pushToast({ title: '无法加载回收站', message: errorMessage(err), tone: 'error' });
    }
  },

  emptyTrash: async () => {
    try {
      const result = await api.emptyTrash();
      set({ trash: [] });
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

  deleteFolder: async (path) => {
    try {
      const result = await api.deleteFolder(path);
      set({ folders: result.folders });
      if (get().activeFolder === path) set({ activeFolder: null });
      await get().refreshNotes({ silent: true });
      get().pushToast({ title: '文件夹已删除', message: path, tone: 'success' });
    } catch (err) {
      get().pushToast({ title: '删除文件夹失败', message: errorMessage(err), tone: 'error' });
    }
  },

  /* -------------------------------- ui --------------------------------- */
  setQuery: (value) => set({ query: value }),
  setActiveTag: (tag) => set({ activeTag: tag }),
  setActiveFolder: (folder) => set({ activeFolder: folder }),
  setFavoriteOnly: (value) => set({ favoriteOnly: value }),
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
  toggleNav: (value) => set((state) => ({ navOpen: value ?? !state.navOpen })),
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