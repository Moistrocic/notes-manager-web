/**
 * Deep links.
 *
 * A note is addressed by its path inside the storage backend, so a link can be
 * pasted anywhere: `/public/Notes/Readme.md#11-分层`. Headings are addressed by
 * the same slug the renderer generates.
 */

const BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');

function encodePath(path: string): string {
  return path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/** URL for a note, optionally pointing at one of its headings. */
export function noteUrl(storagePath: string | null, anchor?: string | null): string {
  const base = BASE || '';
  if (!storagePath) return `${base}/`;
  const href = `${base}/${encodePath(storagePath)}`;
  return anchor ? `${href}#${anchor}` : href;
}

export interface LocationTarget {
  /** Storage path as written in the URL, "" for the root. */
  path: string;
  /** Anchor without the leading "#". */
  anchor: string;
}

/** Reads the note path and anchor out of the current address. */
export function readLocation(): LocationTarget {
  if (typeof window === 'undefined') return { path: '', anchor: '' };
  let rest = window.location.pathname;
  if (BASE && rest.startsWith(BASE)) rest = rest.slice(BASE.length);
  rest = rest.replace(/^\/+/, '');
  let path = rest;
  try {
    path = decodeURIComponent(rest);
  } catch {
    /* keep the raw value */
  }
  return {
    path: path ? `/${path}` : '',
    anchor: window.location.hash.replace(/^#/, ''),
  };
}

/** Rewrites the address bar without reloading or adding a history entry. */
export function replaceLocation(storagePath: string | null, anchor?: string | null): void {
  if (typeof window === 'undefined') return;
  const next = noteUrl(storagePath, anchor);
  if (`${window.location.pathname}${window.location.hash}` === next) return;
  window.history.replaceState(null, '', next);
}

/** Adds a history entry, so the browser back button walks through the notes. */
export function pushLocation(storagePath: string | null, anchor?: string | null): void {
  if (typeof window === 'undefined') return;
  const next = noteUrl(storagePath, anchor);
  if (`${window.location.pathname}${window.location.hash}` === next) return;
  window.history.pushState(null, '', next);
}

/** Updates only the anchor, keeping the current path. */
export function replaceAnchor(anchor: string): void {
  if (typeof window === 'undefined') return;
  const path = window.location.pathname;
  window.history.replaceState(null, '', anchor ? `${path}#${anchor}` : path);
}
