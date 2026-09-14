import { ApiError } from './types';
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
  createNote: (input: { title?: string; content?: string; tags?: string[]; folder?: string }) =>
    request<{ note: Note }>('/notes', { method: 'POST', body: JSON.stringify(input) }),
  updateNote: (id: string, patch: Record<string, unknown>) =>
    request<{ note: Note }>(`/notes/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(patch) }),
  deleteNote: (id: string, permanent = false) =>
    request<{ ok: boolean; trashed: boolean }>(
      `/notes/${encodeURIComponent(id)}${permanent ? '?permanent=true' : ''}`,
      { method: 'DELETE' },
    ),
  listTrash: () => request<{ notes: NoteSummary[] }>('/notes/trash'),
  restoreNote: (id: string) => request<{ note: Note }>(`/notes/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  emptyTrash: () => request<{ ok: boolean; removed: number }>('/notes/trash/empty', { method: 'POST' }),
  tags: () => request<{ tags: TagCount[] }>('/notes/tags'),
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
