import { ApiError } from './types';
import type { BlogIndexPayload, BlogPostPayload } from './types';

const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');
const API_ROOT = `${BASE}/api`;

/**
 * The blog's own reader.
 *
 * Deliberately not `lib/api.ts`: that one talks to the panel, where every
 * answer is about the signed-in account, and it throws an `ApiError` carrying
 * the panel's ideas. These three routes are the site's public face - a visitor
 * with no account reads them - so they are kept apart, and the only thing they
 * share is where the server is and how an error is spelled.
 */
async function request<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_ROOT}${path}`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
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

export const blogApi = {
  /** Everything published, newest first, and whether the blog is on at all. */
  index: () => request<BlogIndexPayload>('/blog'),
  /** One published note, by the storage path its page is addressed by. */
  post: (storagePath: string) => request<BlogPostPayload>(`/blog/post?path=${encodeURIComponent(storagePath)}`),
};

/**
 * Where a picture inside a published note is fetched from.
 *
 * The panel's own `fileUrl` points at `/api/notes/file`, which asks who is
 * asking. A visitor reading the blog has no account, so the public route is the
 * one the pictures have to name - same storage path, no login.
 */
export function blogFileUrl(storagePath: string): string {
  const clean = storagePath.startsWith('/') ? storagePath : `/${storagePath}`;
  return `${API_ROOT}/blog/file?path=${encodeURIComponent(clean)}`;
}
