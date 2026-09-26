/**
 * Deep links.
 *
 * The panel lives under `/manager`: the site's front page is at `/`, and a
 * note is addressed inside the panel by its path in the storage backend, so a
 * link can be pasted anywhere - `/manager/public/Notes/Readme.md#11-分层`.
 * Headings are addressed by the same slug the renderer generates.
 */

const BASE = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');

/** Everything the panel owns sits under this prefix. */
export const MANAGER_SEGMENT = 'manager';

function encodePath(path: string): string {
  return path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/** The front page: deliberately not the panel. */
export function homeUrl(): string {
  return BASE ? `${BASE}/` : '/';
}

/** Whether an address belongs to the panel rather than to the front page. */
export function isManagerPath(pathname: string): boolean {
  let rest = pathname || '/';
  if (BASE && rest.startsWith(BASE)) rest = rest.slice(BASE.length);
  rest = rest.replace(/^\/+/, '');
  return rest === MANAGER_SEGMENT || rest.startsWith(`${MANAGER_SEGMENT}/`);
}

/** The same question, asked of the address the browser is showing. */
export function inManager(): boolean {
  if (typeof window === 'undefined') return false;
  return isManagerPath(window.location.pathname);
}

/** URL for a note, optionally pointing at one of its headings. */
export function noteUrl(storagePath: string | null, anchor?: string | null): string {
  const root = `${BASE}/${MANAGER_SEGMENT}/`;
  if (!storagePath) return root;
  const href = `${BASE}/${MANAGER_SEGMENT}/${encodePath(storagePath)}`;
  return anchor ? `${href}#${anchor}` : href;
}

export interface LocationTarget {
  /** Storage path as written in the URL, "" for the panel root. */
  path: string;
  /** Anchor without the leading "#". */
  anchor: string;
}

/**
 * Reads the note path and anchor out of the current address.
 *
 * An address outside the panel - the front page, most obviously - names no
 * note, so it reads as the panel root with nothing open.
 */
export function readLocation(): LocationTarget {
  if (typeof window === 'undefined') return { path: '', anchor: '' };
  let rest = window.location.pathname;
  if (BASE && rest.startsWith(BASE)) rest = rest.slice(BASE.length);
  rest = rest.replace(/^\/+/, '');
  if (rest === MANAGER_SEGMENT) rest = '';
  else if (rest.startsWith(`${MANAGER_SEGMENT}/`)) rest = rest.slice(MANAGER_SEGMENT.length + 1);
  else rest = '';
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
