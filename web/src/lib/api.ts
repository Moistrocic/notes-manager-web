import { ApiError } from './types';
import type { BackgroundFile, BackgroundOptions } from './admin-background';
import type {
  AuthProviders,
  FontRecord,
  FontSelection,
  AppSettingsPayload,
  Note,
  NoteSummary,
  NotesPayload,
  SessionUser,
  SystemStatus,
  TagCount,
  FolderCount,
  TrashedFolder,
} from './types';

const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
const API_ROOT = `${BASE}/api`;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
      ...init,
    });
  } catch (err) {
    throw new ApiError(`无法连接服务器：${(err as Error).message}`, 0, 'network');
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = (payload as { error?: { message?: string; code?: string } } | null)?.error;
    throw new ApiError(error?.message ?? `请求失败 (${response.status})`, response.status, error?.code);
  }
  return (payload ?? {}) as T;
}

/**
 * Where the browser should fetch a note's .md file from.
 *
 * A plain URL rather than a fetch: the response carries Content-Disposition, so
 * navigating to it lets the browser do the saving, with the file name the server
 * chose. The session cookie rides along because it is same-origin.
 */
export function noteDownloadUrl(id: string): string {
  return `${API_ROOT}/notes/${encodeURIComponent(id)}/download`;
}

/**
 * Where a background file is served from.
 *
 * Built from the API root rather than written out: the app can be installed
 * under a sub path (`--base-path`), and a URL that starts at the domain root
 * then points at nothing - which is a wallpaper that never arrives rather than
 * an error anybody sees. Without a name it is whatever the administrator
 * configured; with one it is that file, which is what the settings dialog
 * previews while a choice is still being made.
 *
 * `version` is the file's content hash when the server knows one. It is what
 * lets the URL - and the browser's copy of it - mean one particular version
 * rather than "whatever is at this address today".
 */
export function backgroundFileUrl(name?: string | null, version?: string | null): string {
  if (!name) return `${API_ROOT}/background/file`;
  const query = new URLSearchParams({ name });
  if (version) query.set('v', version);
  return `${API_ROOT}/background/file?${query.toString()}`;
}

export const api = {
  /* ------------------------------- auth -------------------------------- */
  providers: () => request<AuthProviders>('/auth/providers'),
  me: () => request<{ user: SessionUser | null }>('/auth/me'),
  login: (body: { username: string; password: string; otp?: string; provider?: 'auto' | 'openlist' | 'local' | 'guest' }) =>
    request<{ user: SessionUser; provider: 'openlist' | 'local' }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>('/auth/password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  /* ------------------------------ system ------------------------------- */
  status: () => request<SystemStatus>('/system/status'),
  settings: () => request<AppSettingsPayload>('/system/settings'),
  saveSettings: (settings: unknown) =>
    request<{ settings: AppSettingsPayload['settings']; effective: AppSettingsPayload['effective']; status: unknown }>(
      '/system/settings',
      { method: 'PUT', body: JSON.stringify(settings) },
    ),
  testOpenList: (url: string, token?: string) =>
    request<{ ok: boolean; message: string; details?: Record<string, unknown> }>('/system/openlist/test', {
      method: 'POST',
      body: JSON.stringify({ url, token }),
    }),
  clearCache: () => request<{ ok: boolean }>('/system/cache/clear', { method: 'POST' }),

  /* ------------------------------- fonts ------------------------------- */
  fonts: () => request<{ fonts: FontRecord[]; selection: FontSelection }>('/fonts'),
  uploadFont: async (file: File, name: string) => {
    const response = await fetch(`${API_ROOT}/fonts`, {
      method: 'POST',
      credentials: 'same-origin',
      // raw body: the browser sends exactly the bytes the server stores, and the
      // server needs no multipart parser for a single file field
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Font-Filename': encodeURIComponent(file.name),
        'X-Font-Name': encodeURIComponent(name || file.name.replace(/\.[^.]+$/, '')),
      },
      body: file,
    });
    const text = await response.text();
    let payload: { error?: { message?: string } } & Record<string, unknown> = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = {};
    }
    if (!response.ok) {
      throw new ApiError(payload.error?.message ?? `字体上传失败 (${response.status})`, response.status, 'font_upload');
    }
    return payload as unknown as { font: FontRecord; fonts: FontRecord[]; selection: FontSelection };
  },
  deleteFont: (id: string) =>
    request<{ ok: boolean; fonts: FontRecord[]; selection: FontSelection }>(`/fonts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  selectFonts: (selection: Partial<FontSelection>) =>
    request<{ fonts: FontRecord[]; selection: FontSelection }>('/fonts/selection', {
      method: 'PUT',
      body: JSON.stringify(selection),
    }),

  /* ------------------------------- notes ------------------------------- */
  listNotes: (params: { q?: string; tag?: string; folder?: string; favorite?: boolean; sort?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.q) search.set('q', params.q);
    if (params.tag) search.set('tag', params.tag);
    if (params.folder !== undefined) search.set('folder', params.folder);
    if (params.favorite) search.set('favorite', 'true');
    if (params.sort) search.set('sort', params.sort);
    const qs = search.toString();
    return request<NotesPayload>(`/notes${qs ? `?${qs}` : ''}`);
  },
  getNote: (id: string) => request<{ note: Note }>(`/notes/${encodeURIComponent(id)}`),
  /**
   * Creates a note from an uploaded .md file.
   *
   * Header values are latin-1, so the names are percent-encoded; the server
   * decodes them. Only note files are accepted, by extension and size.
   */
  uploadNote: (file: File, folder?: string) =>
    request<{ note: Note }>('/notes/upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'X-Note-Filename': encodeURIComponent(file.name),
        ...(folder ? { 'X-Note-Folder': encodeURIComponent(folder) } : {}),
      },
      body: file,
    }),

  createNote: (input: { title?: string; content?: string; tags?: string[]; folder?: string }) =>
    request<{ note: Note }>('/notes', { method: 'POST', body: JSON.stringify(input) }),
  updateNote: (id: string, patch: Record<string, unknown>) =>
    request<{ note: Note }>(`/notes/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteNote: (id: string, permanent = false) =>
    request<{ ok: boolean; trashed: boolean }>(
      `/notes/${encodeURIComponent(id)}${permanent ? '?permanent=true' : ''}`,
      { method: 'DELETE' },
    ),
  /** The administrator's default background: which file, and how to show it. */
  background: () =>
    request<{
      configured: boolean;
      file: string | null;
      kind: 'aurora' | 'image' | 'video' | 'scene' | null;
      bytes: number;
      /** Content hash of the configured file, for cache keys. */
      hash: string | null;
      note: string | null;
      options: BackgroundOptions;
      available: BackgroundFile[];
    }>('/background'),

  listTrash: () => request<{ notes: NoteSummary[]; folders: TrashedFolder[] }>('/notes/trash'),
  deleteTrashFolder: (path: string) =>
    request<{ ok: boolean }>(`/notes/trash/folders?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),

  restoreTrashFolder: (path: string) =>
    request<{ ok: boolean; path: string; folders: FolderCount[] }>('/notes/trash/folders/restore', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  restoreNote: (id: string) => request<{ note: Note }>(`/notes/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  emptyTrash: () => request<{ ok: boolean; removed: number }>('/notes/trash/empty', { method: 'POST' }),
  tags: () => request<{ tags: TagCount[] }>('/notes/tags'),
  renameFolder: (path: string, name: string) =>
    request<{ ok: boolean; path: string; folders: FolderCount[] }>('/notes/folders/rename', {
      method: 'POST',
      body: JSON.stringify({ path, name }),
    }),

  createFolder: (path: string) =>
    request<{ folder: string; folders: FolderCount[] }>('/notes/folders', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  deleteFolder: (path: string) =>
    request<{ ok: boolean; folders: FolderCount[] }>(`/notes/folders?path=${encodeURIComponent(path)}`, {
      method: 'DELETE',
    }),
};
